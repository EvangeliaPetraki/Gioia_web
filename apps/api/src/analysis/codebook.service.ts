import { existsSync } from "node:fs";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Workbook, type Worksheet } from "exceljs";
import type {
  CodebookDto,
  CodebookSheetDto,
  CrossDocumentAggregateDto,
  GioiaAnalysis,
  PolicyDetailDto,
  PolicyListItemDto,
} from "@gioia/dto";
import { PrismaService } from "../prisma/prisma.service";
import { CODEBOOK_FILENAME, SHEETS, type ExistingContext } from "./gioia.constants";

/** Result of persisting one document's analysis. */
export interface AppendResult {
  documentId: string;
  newThemes: number;
}

/** Case-study scoping passed through when persisting an analysis. */
export interface AppendScope {
  caseStudyTypeId: string;
  fileHash: string;
}

/** Per-level counts of an already-stored analysis (for the reuse response). */
export interface DocumentCounts {
  excerpts: number;
  firstOrderConcepts: number;
  secondOrderThemes: number;
}

// Legacy bucket that pre-existing (pre-case-study) analyses are attached to on
// boot, so they remain visible in the dashboard tree.
const LEGACY_COUNTRY = "Unassigned";
const LEGACY_REGION = "Legacy documents";
const LEGACY_CASE_STUDY = "Unassigned (legacy)";

// The exported Excel mirrors the /codebook webpage column layout: the
// document-scoped sheets lead with Document_ID, and the same redundant columns
// the webpage hides are dropped from the export too.
const DOC_FIRST_SHEETS = new Set<string>([
  SHEETS.RawDataExtraction.name,
  SHEETS.FirstOrderConcepts.name,
  SHEETS.SecondOrderThemes.name,
]);
const HIDDEN_COLUMNS: Record<string, string[]> = {
  [SHEETS.RawDataExtraction.name]: ["Policy_Name", "Country_or_Region", "Governance_Level"],
  [SHEETS.FirstOrderConcepts.name]: ["Concept_Instance_ID"],
};

type Row = Record<string, string>;

const splitIds = (s: string): string[] =>
  (s ?? "")
    .split(/[;,]/)
    .map((x) => x.trim())
    .filter(Boolean);


/**
 * Source of truth for the Gioia codebook is the database (Postgres via Prisma).
 * This service persists each analysis into normalised tables and rebuilds the
 * structured "codebook" view and the downloadable Excel from those tables.
 */
@Injectable()
export class CodebookService implements OnModuleInit {
  private readonly logger = new Logger(CodebookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** On boot, migrate a pre-existing master Excel into the DB if the DB is empty. */
  async onModuleInit(): Promise<void> {
    try {
      const imported = await this.importLegacyWorkbookIfEmpty();
      if (imported > 0) {
        this.logger.log(`Imported ${imported} legacy document(s) from ${this.legacyPath} into the database.`);
      }
    } catch (e) {
      this.logger.warn(`Legacy codebook import skipped: ${e instanceof Error ? e.message : e}`);
    }
    try {
      await this.backfillLegacyCaseStudy();
    } catch (e) {
      this.logger.warn(`Legacy case-study backfill skipped: ${e instanceof Error ? e.message : e}`);
    }
  }

  get filename(): string {
    return CODEBOOK_FILENAME;
  }

  /** Path of the pre-DB master workbook (used only for the one-time import). */
  private get legacyPath(): string {
    return this.config.get<string>("CODEBOOK_PATH") ?? `./data/${CODEBOOK_FILENAME}`;
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /**
   * Catalogue of analysed policies, most recently analysed first. When
   * `documentIds` is given, only those documents are returned (used to list one
   * region-case-study's selected files).
   */
  async listPolicies(documentIds?: string[]): Promise<PolicyListItemDto[]> {
    const docs = await this.prisma.analyzedDocument.findMany({
      where: documentIds ? { documentId: { in: documentIds } } : undefined,
      orderBy: [{ createdAt: "desc" }, { documentId: "desc" }],
    });
    return docs.map((d) => ({
      documentId: d.documentId,
      policyName: d.policyName,
      countryOrRegion: d.countryOrRegion,
      governanceLevel: d.governanceLevel,
      dateAnalysed: d.dateAnalysed,
    }));
  }

  /**
   * Distinct second-order themes across a set of documents (deduped by Theme_ID),
   * with the documents each theme appears in — input for cross-document
   * aggregate-dimension synthesis.
   */
  async getThemesForDocuments(
    documentIds: string[],
  ): Promise<{ themeId: string; label: string; documents: string[] }[]> {
    const rows = await this.prisma.secondOrderTheme.findMany({
      where: { documentId: { in: documentIds } },
      orderBy: [{ documentId: "asc" }, { orderIndex: "asc" }],
    });
    const byTheme = new Map<string, { label: string; documents: Set<string> }>();
    for (const r of rows) {
      if (!r.themeId) continue;
      const entry = byTheme.get(r.themeId) ?? { label: r.secondOrderTheme, documents: new Set<string>() };
      if (!entry.label) entry.label = r.secondOrderTheme;
      entry.documents.add(r.documentId);
      byTheme.set(r.themeId, entry);
    }
    return Array.from(byTheme, ([themeId, e]) => ({
      themeId,
      label: e.label,
      documents: [...e.documents],
    }));
  }

  /**
   * The concept → theme structure for the selected documents, rebuilt from the
   * stored first-order concepts and second-order themes (one row per distinct
   * concept per document). Per-document analysis stops at themes, so there is no
   * per-document aggregate dimension here — that is added at the case-study level.
   */
  async getConceptThemeStructure(documentIds: string[]): Promise<
    {
      documentId: string;
      conceptId: string;
      firstOrderConcept: string;
      themeId: string;
      secondOrderTheme: string;
    }[]
  > {
    const [concepts, themes] = await Promise.all([
      this.prisma.firstOrderConcept.findMany({
        where: { documentId: { in: documentIds } },
        orderBy: [{ documentId: "asc" }, { orderIndex: "asc" }],
      }),
      this.prisma.secondOrderTheme.findMany({
        where: { documentId: { in: documentIds } },
        orderBy: [{ documentId: "asc" }, { orderIndex: "asc" }],
      }),
    ]);

    // Map each (document, Concept_ID) to the first theme that groups it.
    const themeByDocConcept = new Map<string, { themeId: string; secondOrderTheme: string }>();
    for (const t of themes) {
      for (const cid of splitIds(t.firstOrderConceptIds)) {
        const key = `${t.documentId}::${cid}`;
        if (!themeByDocConcept.has(key)) {
          themeByDocConcept.set(key, { themeId: t.themeId, secondOrderTheme: t.secondOrderTheme });
        }
      }
    }

    const seen = new Set<string>();
    const rows: {
      documentId: string;
      conceptId: string;
      firstOrderConcept: string;
      themeId: string;
      secondOrderTheme: string;
    }[] = [];
    for (const c of concepts) {
      const key = `${c.documentId}::${c.conceptId}`;
      if (seen.has(key)) continue; // one row per first-order concept (type) per document
      seen.add(key);
      const t = themeByDocConcept.get(key);
      rows.push({
        documentId: c.documentId,
        conceptId: c.conceptId,
        firstOrderConcept: c.firstOrderConcept,
        themeId: t?.themeId ?? "",
        secondOrderTheme: t?.secondOrderTheme ?? "",
      });
    }
    return rows;
  }

  // ── Case-study aggregate (persisted per region-case-study) ─────────────────

  /** Save/replace the aggregate synthesis for one region-case-study. */
  async saveCaseStudyAggregate(
    regionCaseStudyId: string,
    result: CrossDocumentAggregateDto,
  ): Promise<void> {
    const data = {
      documentIds: result.documentIds.join(","),
      themeCount: result.themeCount,
      dimensions: JSON.stringify(result.dimensions),
      structureRows: JSON.stringify(result.structureRows),
      generatedAt: new Date(),
    };
    await this.prisma.caseStudyAggregate.upsert({
      where: { regionCaseStudyId },
      create: { regionCaseStudyId, ...data },
      update: data,
    });
  }

  /** The persisted aggregate for a region-case-study, or null if never extracted. */
  async getCaseStudyAggregate(regionCaseStudyId: string): Promise<CrossDocumentAggregateDto | null> {
    const row = await this.prisma.caseStudyAggregate.findUnique({ where: { regionCaseStudyId } });
    if (!row) return null;
    return {
      documentIds: splitIds(row.documentIds),
      themeCount: row.themeCount,
      dimensions: JSON.parse(row.dimensions) as CrossDocumentAggregateDto["dimensions"],
      structureRows: JSON.parse(row.structureRows) as CrossDocumentAggregateDto["structureRows"],
    };
  }

  /**
   * Freshness of a region-case-study's aggregate vs its current file selection:
   * `generatedAt` and how many files differ from the snapshot the aggregate was
   * built from — counting both **additions** and **removals** (0 ⇒ up to date;
   * null generatedAt ⇒ never run).
   */
  async getAggregateStatus(
    regionCaseStudyId: string,
    currentDocIds: string[],
  ): Promise<{ generatedAt: string | null; documentCount: number; staleCount: number }> {
    const row = await this.prisma.caseStudyAggregate.findUnique({ where: { regionCaseStudyId } });
    if (!row) {
      return { generatedAt: null, documentCount: currentDocIds.length, staleCount: currentDocIds.length };
    }
    const snapshot = new Set(splitIds(row.documentIds));
    const current = new Set(currentDocIds);
    const added = currentDocIds.filter((id) => !snapshot.has(id)).length;
    const removed = [...snapshot].filter((id) => !current.has(id)).length;
    return {
      generatedAt: row.generatedAt.toISOString(),
      documentCount: currentDocIds.length,
      staleCount: added + removed,
    };
  }

  /** First-order concepts and second-order themes for one document. */
  async getPolicyDetail(documentId: string): Promise<PolicyDetailDto | null> {
    const doc = await this.prisma.analyzedDocument.findUnique({ where: { documentId } });
    if (!doc) return null;

    const [concepts, themes] = await Promise.all([
      this.prisma.firstOrderConcept.findMany({ where: { documentId }, orderBy: { orderIndex: "asc" } }),
      this.prisma.secondOrderTheme.findMany({ where: { documentId }, orderBy: { orderIndex: "asc" } }),
    ]);

    return {
      documentId,
      policyName: doc.policyName,
      firstOrderConcepts: concepts.map((c) => ({
        conceptId: c.conceptId,
        concept: c.firstOrderConcept,
        excerpt: c.excerptText,
        codingNotes: c.codingNotes,
      })),
      secondOrderThemes: themes.map((t) => ({
        themeId: t.themeId,
        theme: t.secondOrderTheme,
        firstOrderConcepts: t.firstOrderConcepts,
        exampleQuote: t.exampleQuote,
      })),
    };
  }

  /** Set the user's free-text note on a document; returns the saved note, or null if unknown. */
  async updateNote(documentId: string, note: string): Promise<string | null> {
    const exists = await this.prisma.analyzedDocument.findUnique({
      where: { documentId },
      select: { documentId: true },
    });
    if (!exists) return null;
    const updated = await this.prisma.analyzedDocument.update({
      where: { documentId },
      data: { note },
      select: { note: true },
    });
    return updated.note;
  }

  /**
   * One region-case-study's codebook as structured data (one entry per
   * worksheet). Built from that case study's selected `docIds`; the
   * Aggregate_Dimensions and Gioia_Data_Structure sheets are filled from its
   * persisted case-study aggregate (empty until it has been extracted).
   */
  async getWorkbookData(
    docIds: string[],
    aggregate: CrossDocumentAggregateDto | null,
    filename: string,
  ): Promise<CodebookDto> {
    const sheets = await this.buildSheets(docIds, aggregate);
    return { filename, sheets };
  }

  /**
   * Reorder/hide a sheet's columns to match how the /codebook webpage displays
   * it: Document_ID leads the document-scoped sheets, and the redundant columns
   * hidden in the UI are dropped. Rows are remapped to the new column order.
   */
  private applyWebpageLayout(sheet: CodebookSheetDto): CodebookSheetDto {
    const hidden = new Set(HIDDEN_COLUMNS[sheet.name] ?? []);
    let cols = sheet.columns.map((c, i) => ({ c, i }));
    if (DOC_FIRST_SHEETS.has(sheet.name)) {
      const di = cols.findIndex((x) => x.c === "Document_ID");
      if (di > 0) cols = [cols[di], ...cols.filter((_, k) => k !== di)];
    }
    cols = cols.filter((x) => !hidden.has(x.c));
    return {
      name: sheet.name,
      columns: cols.map((x) => x.c),
      rows: sheet.rows.map((r) => cols.map((x) => r[x.i])),
    };
  }

  /**
   * Build one region-case-study's downloadable Excel (its selected `docIds` plus
   * its persisted aggregate) and return it as a Buffer.
   */
  async generateWorkbookBuffer(
    docIds: string[],
    aggregate: CrossDocumentAggregateDto | null,
  ): Promise<Buffer> {
    const sheets = (await this.buildSheets(docIds, aggregate)).map((s) => this.applyWebpageLayout(s));
    const wb = new Workbook();
    for (const def of sheets) {
      const ws = wb.addWorksheet(def.name);
      ws.addRow([...def.columns]);
      ws.getRow(1).font = { bold: true };
      for (let i = 0; i < def.columns.length; i++) ws.getColumn(i + 1).width = 28;
      for (const row of def.rows) ws.addRow(row);
    }
    const out = await wb.xlsx.writeBuffer();
    return Buffer.from(out);
  }

  /** Build the Excel export for a cross-document aggregate extraction result. */
  async generateAggregateWorkbookBuffer(result: CrossDocumentAggregateDto): Promise<Buffer> {
    const wb = new Workbook();

    const structure = wb.addWorksheet("Gioia Data Structure");
    structure.addRow([
      "Document_ID",
      "Concept_ID",
      "First_Order_Concept",
      "Theme_ID",
      "Second_Order_Theme",
      "Cross_Document_Aggregate_ID",
      "Cross_Document_Aggregate_Dimension",
      "Source_Aggregate_ID",
      "Source_Aggregate_Dimension",
    ]);
    for (const row of result.structureRows) {
      structure.addRow([
        row.documentId,
        row.conceptId,
        row.firstOrderConcept,
        row.themeId,
        row.secondOrderTheme,
        row.aggregateId,
        row.aggregateDimension,
        row.sourceAggregateId,
        row.sourceAggregateDimension,
      ]);
    }

    const dimensions = wb.addWorksheet("Aggregate Dimensions");
    dimensions.addRow([
      "Aggregate_ID",
      "Aggregate_Dimension",
      "Description",
      "Second_Order_Themes",
      "Theme_IDs",
      "Example_Policies",
    ]);
    for (const d of result.dimensions) {
      dimensions.addRow([
        d.aggregateId,
        d.aggregateDimension,
        d.description,
        d.secondOrderThemes,
        d.themeIds,
        d.examplePolicies,
      ]);
    }

    const summary = wb.addWorksheet("Selected Documents");
    summary.addRow(["Document_ID"]);
    for (const id of result.documentIds) summary.addRow([id]);

    for (const ws of wb.worksheets) {
      ws.getRow(1).font = { bold: true };
      for (let i = 1; i <= ws.columnCount; i++) ws.getColumn(i).width = 28;
    }

    const out = await wb.xlsx.writeBuffer();
    return Buffer.from(out);
  }

  /**
   * The existing codebook's distinct code vocabulary, split by level (document
   * ids + first-order concepts + second-order themes + aggregate dimensions), so
   * each pipeline stage can be handed only the level it reuses (Step 7).
   */
  async getExistingContext(caseStudyTypeId: string): Promise<ExistingContext> {
    const docs = await this.prisma.analyzedDocument.findMany({
      where: { caseStudyTypeId },
      select: { documentId: true },
      orderBy: { createdAt: "asc" },
    });
    if (docs.length === 0) {
      return { documentIds: [], concepts: [], themes: [], dimensions: [], isEmpty: true };
    }

    const docIds = docs.map((d) => d.documentId);
    const [concepts, themes] = await Promise.all([
      this.distinctPairs("firstOrderConcept", "conceptId", "firstOrderConcept", docIds),
      this.distinctPairs("secondOrderTheme", "themeId", "secondOrderTheme", docIds),
    ]);

    // Per-document coding stops at themes, so there are no per-document aggregate
    // dimensions to reuse — that vocabulary lives at the case-study level.
    return {
      documentIds: docIds,
      concepts,
      themes,
      dimensions: [],
      isEmpty: false,
    };
  }

  private async distinctPairs(
    model: "firstOrderConcept" | "secondOrderTheme",
    idField: string,
    labelField: string,
    docIds: string[],
  ): Promise<string[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: Record<string, string>[] = await (this.prisma[model] as any).findMany({
      where: { documentId: { in: docIds } },
      orderBy: { id: "asc" },
    });
    const seen = new Map<string, string>();
    for (const r of rows) {
      const id = r[idField];
      if (id && !seen.has(id)) seen.set(id, r[labelField] ?? "");
    }
    return Array.from(seen, ([id, label]) => `${id}: ${label}`);
  }

  // ── Writes ───────────────────────────────────────────────────────────────

  /** The already-stored analysis of this file under this case-study type, if any. */
  async findByHash(fileHash: string, caseStudyTypeId: string) {
    return this.prisma.analyzedDocument.findFirst({
      where: { fileHash, caseStudyTypeId },
    });
  }

  /** Per-level counts for an already-stored analysis. */
  async countsFor(documentId: string): Promise<DocumentCounts> {
    const [excerpts, firstOrderConcepts, secondOrderThemes] = await Promise.all([
      this.prisma.rawExcerpt.count({ where: { documentId } }),
      this.prisma.firstOrderConcept.count({ where: { documentId } }),
      this.prisma.secondOrderTheme.count({ where: { documentId } }),
    ]);
    return { excerpts, firstOrderConcepts, secondOrderThemes };
  }

  /** Persist a completed analysis into the database, scoped to a case-study type. */
  async append(analysis: GioiaAnalysis, sourceFile: string, scope: AppendScope): Promise<AppendResult> {
    // Ensure a unique Document_ID; re-prefix doc-scoped IDs if it collides.
    const existing = await this.prisma.analyzedDocument.findMany({ select: { documentId: true } });
    const existingDocIds = new Set(existing.map((d) => d.documentId));
    let documentId = analysis.policy_metadata.Document_ID?.trim() || "DOC_01";
    if (existingDocIds.has(documentId)) {
      const original = documentId;
      let n = 2;
      while (existingDocIds.has(`${original}_v${n}`)) n++;
      documentId = `${original}_v${n}`;
      analysis = this.rePrefix(analysis, original, documentId);
    }

    // "New" themes are judged within the case study, matching the scoped reuse
    // context the model was given.
    const priorThemeIds = new Set(
      (
        await this.prisma.secondOrderTheme.findMany({
          where: { document: { caseStudyTypeId: scope.caseStudyTypeId } },
          select: { themeId: true },
        })
      ).map((t) => t.themeId),
    );

    await this.persist(analysis, documentId, sourceFile, scope);

    const newThemes = analysis.second_order_themes.filter((t) => !priorThemeIds.has(t.Theme_ID)).length;
    this.logger.log(`Stored ${documentId} in the database.`);
    return { documentId, newThemes };
  }

  /** Insert one document and all its child rows in a single transaction. */
  private async persist(
    analysis: GioiaAnalysis,
    documentId: string,
    sourceFile: string,
    scope: AppendScope,
  ): Promise<void> {
    const meta = analysis.policy_metadata;
    const dateAnalysed = new Date().toISOString().slice(0, 10);

    await this.prisma.$transaction([
      this.prisma.analyzedDocument.create({
        data: {
          documentId,
          policyName: meta.Policy_Name ?? "",
          countryOrRegion: meta.Country_or_Region ?? "",
          governanceLevel: String(meta.Governance_Level ?? ""),
          policyYear: meta.Policy_Year ?? "",
          issuingActor: meta.Issuing_Actor ?? "",
          policyType: meta.Policy_Type ?? "",
          sourceFile,
          fileHash: scope.fileHash,
          caseStudyTypeId: scope.caseStudyTypeId,
          dateAnalysed,
          policySummary: analysis.policy_summary ?? "",
          refinementSummary: analysis.refinement_summary ?? "",
          rqFocus: analysis.research_question_memo?.RQ_Focus ?? "",
          analyticalMemo: analysis.research_question_memo?.Analytical_Memo ?? "",
        },
      }),
      this.prisma.rawExcerpt.createMany({
        data: analysis.raw_data_extraction.map((r, i) => ({
          documentId,
          orderIndex: i,
          rawId: r.Raw_ID ?? "",
          sectionPage: r.Section_Page ?? "",
          excerptText: r.Excerpt_Text ?? "",
          initialNotes: r.Initial_Notes ?? "",
          analyticalFlags: r.Analytical_Flags ?? "",
        })),
      }),
      this.prisma.firstOrderConcept.createMany({
        data: analysis.first_order_concepts.map((c, i) => ({
          documentId,
          orderIndex: i,
          conceptInstanceId: c.Concept_Instance_ID ?? "",
          conceptId: c.Concept_ID ?? "",
          rawId: c.Raw_ID ?? "",
          excerptText: c.Excerpt_Text ?? "",
          firstOrderConcept: c.First_Order_Concept ?? "",
          codingNotes: c.Coding_Notes ?? "",
        })),
      }),
      this.prisma.secondOrderTheme.createMany({
        data: analysis.second_order_themes.map((t, i) => ({
          documentId,
          orderIndex: i,
          themeId: t.Theme_ID ?? "",
          firstOrderConceptIds: t.First_Order_Concept_IDs ?? "",
          firstOrderConcepts: t.First_Order_Concepts ?? "",
          secondOrderTheme: t.Second_Order_Theme ?? "",
          exampleQuote: t.Example_Quote ?? "",
        })),
      }),
    ]);
  }

  /** Replace every occurrence of an old Document_ID prefix with a new one. */
  private rePrefix(analysis: GioiaAnalysis, oldId: string, newId: string): GioiaAnalysis {
    const swap = (s: string) => (s ? s.split(oldId).join(newId) : s);
    return {
      ...analysis,
      policy_metadata: { ...analysis.policy_metadata, Document_ID: newId },
      raw_data_extraction: analysis.raw_data_extraction.map((r) => ({ ...r, Raw_ID: swap(r.Raw_ID) })),
      first_order_concepts: analysis.first_order_concepts.map((c) => ({
        ...c,
        Concept_Instance_ID: swap(c.Concept_Instance_ID),
        Raw_ID: swap(c.Raw_ID),
      })),
    };
  }

  // ── Codebook view (DB → sheets) ────────────────────────────────────────────

  /**
   * Build the 9 worksheet views (columns + positional rows) for one region-case-
   * study: the document-scoped sheets from `docIds`, and the Aggregate_Dimensions
   * + Gioia_Data_Structure sheets from the persisted case-study `aggregate`.
   */
  private async buildSheets(
    docIds: string[],
    aggregate: CrossDocumentAggregateDto | null,
  ): Promise<CodebookDto["sheets"]> {
    const where = { documentId: { in: docIds } };
    const [docs, raw, foc, sot] = await Promise.all([
      this.prisma.analyzedDocument.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { documentId: "desc" }],
      }),
      this.prisma.rawExcerpt.findMany({ where }),
      this.prisma.firstOrderConcept.findMany({ where }),
      this.prisma.secondOrderTheme.findMany({ where }),
    ]);

    const order = new Map(docs.map((d, i) => [d.documentId, i]));
    const byId = new Map(docs.map((d) => [d.documentId, d]));
    const sort = <T extends { documentId: string; orderIndex: number }>(rows: T[]): T[] =>
      [...rows].sort(
        (a, b) => (order.get(a.documentId) ?? 0) - (order.get(b.documentId) ?? 0) || a.orderIndex - b.orderIndex,
      );

    const meta = (def: { name: string; columns: readonly string[] }, records: Row[]) => ({
      name: def.name,
      columns: [...def.columns],
      rows: records.map((rec) => def.columns.map((c) => rec[c] ?? "")),
    });

    return [
      meta(
        SHEETS.PolicyMetadata,
        docs.map((d) => ({
          Document_ID: d.documentId,
          Policy_Name: d.policyName,
          Country_or_Region: d.countryOrRegion,
          Governance_Level: d.governanceLevel,
          Policy_Year: d.policyYear,
          Issuing_Actor: d.issuingActor,
          Policy_Type: d.policyType,
          Source_File: d.sourceFile,
          Date_Analysed: d.dateAnalysed,
          Note: d.note,
        })),
      ),
      meta(
        SHEETS.RawDataExtraction,
        sort(raw).map((r) => ({
          Raw_ID: r.rawId,
          Document_ID: r.documentId,
          Policy_Name: byId.get(r.documentId)?.policyName ?? "",
          Country_or_Region: byId.get(r.documentId)?.countryOrRegion ?? "",
          Governance_Level: byId.get(r.documentId)?.governanceLevel ?? "",
          "Section/Page": r.sectionPage,
          Excerpt_Text: r.excerptText,
          Initial_Notes: r.initialNotes,
          Analytical_Flags: r.analyticalFlags,
        })),
      ),
      meta(
        SHEETS.FirstOrderConcepts,
        sort(foc).map((c) => ({
          Concept_Instance_ID: c.conceptInstanceId,
          Concept_ID: c.conceptId,
          Document_ID: c.documentId,
          Raw_ID: c.rawId,
          Excerpt_Text: c.excerptText,
          First_Order_Concept: c.firstOrderConcept,
          Coding_Notes: c.codingNotes,
        })),
      ),
      meta(
        SHEETS.SecondOrderThemes,
        sort(sot).map((t) => ({
          Theme_ID: t.themeId,
          Document_ID: t.documentId,
          First_Order_Concept_IDs: t.firstOrderConceptIds,
          First_Order_Concepts: t.firstOrderConcepts,
          Second_Order_Theme: t.secondOrderTheme,
          Example_Quote: t.exampleQuote,
        })),
      ),
      meta(
        SHEETS.AggregateDimensions,
        (aggregate?.dimensions ?? []).map((a) => ({
          Aggregate_ID: a.aggregateId,
          Theme_ID: a.themeIds,
          Second_Order_Themes: a.secondOrderThemes,
          Aggregate_Dimension: a.aggregateDimension,
          Description: a.description,
          Example_Policies: a.examplePolicies,
        })),
      ),
      meta(
        SHEETS.GioiaDataStructure,
        (aggregate?.structureRows ?? []).map((g) => ({
          Document_ID: g.documentId,
          Concept_ID: g.conceptId,
          First_Order_Concept: g.firstOrderConcept,
          Theme_ID: g.themeId,
          Second_Order_Theme: g.secondOrderTheme,
          Aggregate_ID: g.aggregateId,
          Aggregate_Dimension: g.aggregateDimension,
        })),
      ),
      meta(
        SHEETS.PolicySummary,
        docs.map((d) => ({ Document_ID: d.documentId, Policy_Summary: d.policySummary })),
      ),
      meta(
        SHEETS.RefinementSummary,
        docs.map((d) => ({ Document_ID: d.documentId, Refinement_Summary: d.refinementSummary })),
      ),
      meta(
        SHEETS.ResearchQuestionMemo,
        docs.map((d) => ({
          Document_ID: d.documentId,
          RQ_Focus: d.rqFocus,
          Analytical_Memo: d.analyticalMemo,
        })),
      ),
    ];
  }

  // ── One-time migration of a pre-DB Excel into the DB ───────────────────────

  /** Read every data row of a worksheet as a record keyed by column header. */
  private readRows(sheet: Worksheet | undefined): Row[] {
    if (!sheet) return [];
    const headerRow = sheet.getRow(1).values as unknown[];
    const rows: Row[] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const rec: Row = {};
      for (let i = 1; i < headerRow.length; i++) {
        const header = headerRow[i];
        if (header == null) continue;
        const cell = row.getCell(i).value;
        rec[String(header)] = cell == null ? "" : String(cell).trim();
      }
      rows.push(rec);
    });
    return rows;
  }

  /**
   * If the DB has no documents but a legacy master Excel exists on disk, import
   * it once. Aggregate-dimension rows (no Document_ID column) are attributed to
   * the first document named in their Example_Policies, else the first document.
   */
  async importLegacyWorkbookIfEmpty(): Promise<number> {
    const count = await this.prisma.analyzedDocument.count();
    if (count > 0 || !existsSync(this.legacyPath)) return 0;

    const wb = new Workbook();
    await wb.xlsx.readFile(this.legacyPath);

    const metaRows = this.readRows(wb.getWorksheet(SHEETS.PolicyMetadata.name));
    if (metaRows.length === 0) return 0;

    const byDoc = <T extends Row>(rows: T[]) => (id: string) => rows.filter((r) => r.Document_ID === id);

    const raw = byDoc(this.readRows(wb.getWorksheet(SHEETS.RawDataExtraction.name)));
    const foc = byDoc(this.readRows(wb.getWorksheet(SHEETS.FirstOrderConcepts.name)));
    const sot = byDoc(this.readRows(wb.getWorksheet(SHEETS.SecondOrderThemes.name)));
    const summaries = this.readRows(wb.getWorksheet(SHEETS.PolicySummary.name));
    const refinements = this.readRows(wb.getWorksheet(SHEETS.RefinementSummary.name));
    const memos = this.readRows(wb.getWorksheet(SHEETS.ResearchQuestionMemo.name));

    const lookup = (rows: Row[], id: string, field: string) =>
      rows.find((r) => r.Document_ID === id)?.[field] ?? "";

    for (const m of metaRows) {
      const id = m.Document_ID;
      await this.prisma.$transaction([
        this.prisma.analyzedDocument.create({
          data: {
            documentId: id,
            policyName: m.Policy_Name ?? "",
            countryOrRegion: m.Country_or_Region ?? "",
            governanceLevel: m.Governance_Level ?? "",
            policyYear: m.Policy_Year ?? "",
            issuingActor: m.Issuing_Actor ?? "",
            policyType: m.Policy_Type ?? "",
            sourceFile: m.Source_File ?? "",
            dateAnalysed: m.Date_Analysed ?? "",
            policySummary: lookup(summaries, id, "Policy_Summary"),
            refinementSummary: lookup(refinements, id, "Refinement_Summary"),
            rqFocus: lookup(memos, id, "RQ_Focus"),
            analyticalMemo: lookup(memos, id, "Analytical_Memo"),
          },
        }),
        this.prisma.rawExcerpt.createMany({
          data: raw(id).map((r, i) => ({
            documentId: id,
            orderIndex: i,
            rawId: r.Raw_ID ?? "",
            sectionPage: r["Section/Page"] ?? "",
            excerptText: r.Excerpt_Text ?? "",
            initialNotes: r.Initial_Notes ?? "",
            analyticalFlags: r.Analytical_Flags ?? "",
          })),
        }),
        this.prisma.firstOrderConcept.createMany({
          data: foc(id).map((c, i) => ({
            documentId: id,
            orderIndex: i,
            conceptInstanceId: c.Concept_Instance_ID ?? "",
            conceptId: c.Concept_ID ?? "",
            rawId: c.Raw_ID ?? "",
            excerptText: c.Excerpt_Text ?? "",
            firstOrderConcept: c.First_Order_Concept ?? "",
            codingNotes: c.Coding_Notes ?? "",
          })),
        }),
        this.prisma.secondOrderTheme.createMany({
          data: sot(id).map((t, i) => ({
            documentId: id,
            orderIndex: i,
            themeId: t.Theme_ID ?? "",
            firstOrderConceptIds: t.First_Order_Concept_IDs ?? "",
            firstOrderConcepts: t.First_Order_Concepts ?? "",
            secondOrderTheme: t.Second_Order_Theme ?? "",
            exampleQuote: t.Example_Quote ?? "",
          })),
        }),
      ]);
    }

    return metaRows.length;
  }

  /**
   * Attach any pre-case-study analyses (caseStudyTypeId = null) to a single
   * "legacy" region/case-study so they stay visible and queryable. Their
   * fileHash is synthesised from the Document_ID (the original bytes are gone),
   * which is unique and so satisfies the (fileHash, caseStudyTypeId) index.
   */
  private async backfillLegacyCaseStudy(): Promise<void> {
    const orphans = await this.prisma.analyzedDocument.findMany({
      where: { caseStudyTypeId: null },
      select: { documentId: true },
    });
    if (orphans.length === 0) return;

    const type = await this.prisma.caseStudyType.upsert({
      where: { name: LEGACY_CASE_STUDY },
      create: { name: LEGACY_CASE_STUDY },
      update: {},
    });
    const region = await this.prisma.region.upsert({
      where: { country_name: { country: LEGACY_COUNTRY, name: LEGACY_REGION } },
      create: { country: LEGACY_COUNTRY, name: LEGACY_REGION },
      update: {},
    });
    const rcs = await this.prisma.regionCaseStudy.upsert({
      where: { regionId_caseStudyTypeId: { regionId: region.id, caseStudyTypeId: type.id } },
      create: { regionId: region.id, caseStudyTypeId: type.id },
      update: {},
    });

    for (const o of orphans) {
      await this.prisma.$transaction([
        this.prisma.analyzedDocument.update({
          where: { documentId: o.documentId },
          data: { caseStudyTypeId: type.id, fileHash: `legacy:${o.documentId}` },
        }),
        this.prisma.fileSelection.upsert({
          where: {
            regionCaseStudyId_documentId: { regionCaseStudyId: rcs.id, documentId: o.documentId },
          },
          create: { regionCaseStudyId: rcs.id, documentId: o.documentId, originalFilename: "" },
          update: {},
        }),
      ]);
    }
    this.logger.log(`Backfilled ${orphans.length} legacy document(s) onto "${LEGACY_CASE_STUDY}".`);
  }
}

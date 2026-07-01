import { existsSync } from "node:fs";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Workbook, type Worksheet } from "exceljs";
import type {
  CodebookDto,
  CodebookSheetDto,
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
  }

  get filename(): string {
    return CODEBOOK_FILENAME;
  }

  /** Path of the pre-DB master workbook (used only for the one-time import). */
  private get legacyPath(): string {
    return this.config.get<string>("CODEBOOK_PATH") ?? `./data/${CODEBOOK_FILENAME}`;
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /** Catalogue of analysed policies, most recently analysed first. */
  async listPolicies(): Promise<PolicyListItemDto[]> {
    const docs = await this.prisma.analyzedDocument.findMany({
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

  /** The whole codebook as structured data (one entry per worksheet), built from the DB. */
  async getWorkbookData(): Promise<CodebookDto> {
    const sheets = await this.buildSheets();
    return { filename: this.filename, sheets };
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
   * Build the downloadable Excel from the DB and return it as a Buffer. When
   * `docIds` is given, only those documents are included (filtered export).
   */
  async generateWorkbookBuffer(docIds?: string[]): Promise<Buffer> {
    const filter = docIds ? new Set(docIds) : undefined;
    const sheets = (await this.buildSheets(filter)).map((s) => this.applyWebpageLayout(s));
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

  /**
   * The existing codebook's distinct code vocabulary, split by level (document
   * ids + first-order concepts + second-order themes + aggregate dimensions), so
   * each pipeline stage can be handed only the level it reuses (Step 7).
   */
  async getExistingContext(): Promise<ExistingContext> {
    const docs = await this.prisma.analyzedDocument.findMany({
      select: { documentId: true },
      orderBy: { createdAt: "asc" },
    });
    if (docs.length === 0) {
      return { documentIds: [], concepts: [], themes: [], dimensions: [], isEmpty: true };
    }

    const [concepts, themes, dimensions] = await Promise.all([
      this.distinctPairs("firstOrderConcept", "conceptId", "firstOrderConcept"),
      this.distinctPairs("secondOrderTheme", "themeId", "secondOrderTheme"),
      this.distinctPairs("aggregateDimension", "aggregateId", "aggregateDimension"),
    ]);

    return {
      documentIds: docs.map((d) => d.documentId),
      concepts,
      themes,
      dimensions,
      isEmpty: false,
    };
  }

  private async distinctPairs(
    model: "firstOrderConcept" | "secondOrderTheme" | "aggregateDimension",
    idField: string,
    labelField: string,
  ): Promise<string[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: Record<string, string>[] = await (this.prisma[model] as any).findMany({
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

  /** Persist a completed analysis into the database. */
  async append(analysis: GioiaAnalysis, sourceFile: string): Promise<AppendResult> {
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

    const priorThemeIds = new Set(
      (await this.prisma.secondOrderTheme.findMany({ select: { themeId: true } })).map((t) => t.themeId),
    );

    await this.persist(analysis, documentId, sourceFile);

    const newThemes = analysis.second_order_themes.filter((t) => !priorThemeIds.has(t.Theme_ID)).length;
    this.logger.log(`Stored ${documentId} in the database.`);
    return { documentId, newThemes };
  }

  /** Insert one document and all its child rows in a single transaction. */
  private async persist(analysis: GioiaAnalysis, documentId: string, sourceFile: string): Promise<void> {
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
      this.prisma.aggregateDimension.createMany({
        data: analysis.aggregate_dimensions.map((a, i) => ({
          documentId,
          orderIndex: i,
          aggregateId: a.Aggregate_ID ?? "",
          themeIds: a.Theme_IDs ?? "",
          secondOrderThemes: a.Second_Order_Themes ?? "",
          aggregateDimension: a.Aggregate_Dimension ?? "",
          description: a.Description ?? "",
          examplePolicies: a.Example_Policies || documentId,
        })),
      }),
      this.prisma.gioiaStructureRow.createMany({
        data: analysis.gioia_data_structure.map((g, i) => ({
          documentId,
          orderIndex: i,
          conceptId: g.Concept_ID ?? "",
          firstOrderConcept: g.First_Order_Concept ?? "",
          themeId: g.Theme_ID ?? "",
          secondOrderTheme: g.Second_Order_Theme ?? "",
          aggregateId: g.Aggregate_ID ?? "",
          aggregateDimension: g.Aggregate_Dimension ?? "",
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
      aggregate_dimensions: analysis.aggregate_dimensions.map((a) => ({
        ...a,
        Example_Policies: swap(a.Example_Policies),
      })),
    };
  }

  // ── Codebook view (DB → sheets) ────────────────────────────────────────────

  /** Build the 9 worksheet views (columns + positional rows) from the DB. */
  private async buildSheets(docIds?: Set<string>): Promise<CodebookDto["sheets"]> {
    const where = docIds ? { documentId: { in: [...docIds] } } : undefined;
    const [docs, raw, foc, sot, agg, gds] = await Promise.all([
      this.prisma.analyzedDocument.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { documentId: "desc" }],
      }),
      this.prisma.rawExcerpt.findMany({ where }),
      this.prisma.firstOrderConcept.findMany({ where }),
      this.prisma.secondOrderTheme.findMany({ where }),
      this.prisma.aggregateDimension.findMany({ where }),
      this.prisma.gioiaStructureRow.findMany({ where }),
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
        sort(agg).map((a) => ({
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
        sort(gds).map((g) => ({
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

    const docIds = metaRows.map((m) => m.Document_ID);
    const byDoc = <T extends Row>(rows: T[]) => (id: string) => rows.filter((r) => r.Document_ID === id);

    const raw = byDoc(this.readRows(wb.getWorksheet(SHEETS.RawDataExtraction.name)));
    const foc = byDoc(this.readRows(wb.getWorksheet(SHEETS.FirstOrderConcepts.name)));
    const sot = byDoc(this.readRows(wb.getWorksheet(SHEETS.SecondOrderThemes.name)));
    const gds = byDoc(this.readRows(wb.getWorksheet(SHEETS.GioiaDataStructure.name)));
    const summaries = this.readRows(wb.getWorksheet(SHEETS.PolicySummary.name));
    const refinements = this.readRows(wb.getWorksheet(SHEETS.RefinementSummary.name));
    const memos = this.readRows(wb.getWorksheet(SHEETS.ResearchQuestionMemo.name));
    const aggAll = this.readRows(wb.getWorksheet(SHEETS.AggregateDimensions.name));

    const lookup = (rows: Row[], id: string, field: string) =>
      rows.find((r) => r.Document_ID === id)?.[field] ?? "";

    // Attribute each aggregate row to the first document it references.
    const aggByDoc = new Map<string, Row[]>();
    for (const a of aggAll) {
      const owner = docIds.find((id) => (a.Example_Policies ?? "").includes(id)) ?? docIds[0];
      (aggByDoc.get(owner) ?? aggByDoc.set(owner, []).get(owner)!).push(a);
    }

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
        this.prisma.aggregateDimension.createMany({
          data: (aggByDoc.get(id) ?? []).map((a, i) => ({
            documentId: id,
            orderIndex: i,
            aggregateId: a.Aggregate_ID ?? "",
            themeIds: a.Theme_ID ?? "",
            secondOrderThemes: a.Second_Order_Themes ?? "",
            aggregateDimension: a.Aggregate_Dimension ?? "",
            description: a.Description ?? "",
            examplePolicies: a.Example_Policies ?? "",
          })),
        }),
        this.prisma.gioiaStructureRow.createMany({
          data: gds(id).map((g, i) => ({
            documentId: id,
            orderIndex: i,
            conceptId: g.Concept_ID ?? "",
            firstOrderConcept: g.First_Order_Concept ?? "",
            themeId: g.Theme_ID ?? "",
            secondOrderTheme: g.Second_Order_Theme ?? "",
            aggregateId: g.Aggregate_ID ?? "",
            aggregateDimension: g.Aggregate_Dimension ?? "",
          })),
        }),
      ]);
    }

    return metaRows.length;
  }
}

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import type {
  AnalysisErrorDto,
  AnalysisSettingsDto,
  AnalysisSettingsResponseDto,
  AnalysisSummaryDto,
  CaseStudyAggregateStatusDto,
  CodebookDto,
  CrossDocumentAggregateDto,
  PolicyDetailDto,
  PolicyListItemDto,
  UpdateAnalysisSettingsDto,
  UsageReportDto,
} from "@gioia/dto";
import type { PromptsDto } from "@gioia/dto";
import { PdfService } from "./pdf.service";
import { GioiaService } from "./gioia.service";
import { CodebookService } from "./codebook.service";
import { CaseStudyService } from "./case-study.service";
import { SettingsService } from "./settings.service";
import { UsageService } from "./usage.service";
import { AnalysisErrorService } from "./analysis-error.service";
import { buildPromptView } from "./gioia.constants";
import type { Viewer } from "../auth/current-user.decorator";

const splitIds = (s: string) =>
  s
    .split(/[;,]/)
    .map((x) => x.trim())
    .filter(Boolean);

/** The model's raw text an error was built from (see gioia.service.ts's parseJson), if any. */
const rawOutputOf = (e: unknown): string | null => {
  const cause = e instanceof Error ? (e as Error & { cause?: unknown }).cause : undefined;
  return typeof cause === "string" ? cause : null;
};

@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly pdf: PdfService,
    private readonly gioia: GioiaService,
    private readonly codebook: CodebookService,
    private readonly caseStudies: CaseStudyService,
    private readonly usage: UsageService,
    private readonly errors: AnalysisErrorService,
  ) {}

  /**
   * Analyse an uploaded PDF within a region's case study. If the same file
   * (by content hash) was already analysed under this case-study *type* — even
   * for another region — that analysis is reused by default: it is linked into
   * this case study and the model is not re-run. When `forceReanalyze` is on,
   * an existing match is instead re-run and replaced in place. Otherwise (no
   * existing match) the file is analysed once, stored under the case-study
   * type, and linked.
   */
  async analyseDocument(
    fileName: string,
    buffer: Buffer,
    regionCaseStudyId: string,
    viewer: Viewer,
    forceReanalyze = false,
  ): Promise<AnalysisSummaryDto> {
    if (!regionCaseStudyId?.trim()) {
      throw new BadRequestException("Select a case study to upload into.");
    }
    try {
      const { regionCaseStudyId: rcsId, caseStudyTypeId, caseStudyName } =
        await this.caseStudies.resolveCaseStudyType(regionCaseStudyId.trim(), viewer);
      const fileHash = createHash("sha256").update(buffer).digest("hex");

      const existing = await this.codebook.findByHash(fileHash, caseStudyTypeId);

      // Reuse path (default): this file was already analysed under this
      // case-study type and re-analysis was not requested.
      if (existing && !forceReanalyze) {
        await this.caseStudies.linkSelection(rcsId, existing.documentId, fileName);
        const counts = await this.codebook.countsFor(existing.documentId);
        return {
          documentId: existing.documentId,
          policyName: existing.policyName,
          governanceLevel: existing.governanceLevel,
          counts: { ...counts, newThemes: 0 },
          policySummary: existing.policySummary,
          workbookFilename: this.codebook.filename,
          reused: true,
          reanalyzed: false,
        };
      }

      // Fresh model run, scoped to the case-study type for context reuse —
      // either a genuinely new file, or an existing one being force-re-analysed.
      const text = await this.pdf.extractText(buffer);
      const existingContext = await this.codebook.getExistingContext(caseStudyTypeId);
      const { analysis, usage } = await this.gioia.analyse(
        text,
        fileName,
        existingContext,
        caseStudyName,
      );
      const scope = { caseStudyTypeId, fileHash };
      let reusedDocument: typeof existing = null;
      let result: { documentId: string; newThemes: number };
      let reanalyzed = Boolean(existing);
      try {
        result = existing
          ? await this.codebook.replace(existing.documentId, analysis, fileName, scope)
          : await this.codebook.append(analysis, fileName, scope);
      } catch (e) {
        // Another upload may have saved this file while the model was running.
        // Only recover a create collision with a matching file/type record;
        // update failures and unrelated database errors must still surface.
        if (existing || !(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") {
          throw e;
        }
        const concurrent = await this.codebook.findByHash(fileHash, caseStudyTypeId);
        if (!concurrent) throw e;
        if (forceReanalyze) {
          result = await this.codebook.replace(concurrent.documentId, analysis, fileName, scope);
          reanalyzed = true;
        } else {
          reusedDocument = concurrent;
          result = { documentId: concurrent.documentId, newThemes: 0 };
        }
      }
      const { documentId, newThemes } = result;
      await this.caseStudies.linkSelection(rcsId, documentId, fileName);
      // Ledger: the full cost of analysing this file (all stages + repairs).
      await this.usage.record({ kind: "analysis", events: usage, documentId, caseStudyTypeId });

      if (reusedDocument) {
        const counts = await this.codebook.countsFor(documentId);
        return {
          documentId,
          policyName: reusedDocument.policyName,
          governanceLevel: reusedDocument.governanceLevel,
          counts: { ...counts, newThemes: 0 },
          policySummary: reusedDocument.policySummary,
          workbookFilename: this.codebook.filename,
          reused: true,
          reanalyzed: false,
        };
      }

      return {
        documentId,
        policyName: analysis.policy_metadata.Policy_Name,
        governanceLevel: analysis.policy_metadata.Governance_Level,
        counts: {
          excerpts: analysis.raw_data_extraction.length,
          firstOrderConcepts: analysis.first_order_concepts.length,
          secondOrderThemes: analysis.second_order_themes.length,
          newThemes,
        },
        policySummary: analysis.policy_summary,
        workbookFilename: this.codebook.filename,
        reused: false,
        reanalyzed,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : "unexpected error";
      // Best-effort: so the admin can inspect why this file failed (including
      // the model's raw output, when the failure was unparseable JSON)
      // without digging through server logs.
      await this.errors.record({
        fileName,
        message,
        rawOutput: rawOutputOf(e),
        regionCaseStudyId: regionCaseStudyId.trim(),
      });
      // Intentional 4xx/5xx (bad request, model unavailable, forbidden…) pass
      // through untouched. Anything else is an unexpected bug — log the full
      // stack (so it shows in the server console) and surface a real message
      // instead of a bare "Internal server error".
      if (e instanceof HttpException) throw e;
      this.logger.error(
        `analyseDocument failed for "${fileName}": ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
      );
      throw new ServiceUnavailableException(`Analysis failed: ${message}`);
    }
  }

  listPolicies(): Promise<PolicyListItemDto[]> {
    return this.codebook.listPolicies();
  }

  /** The analysed files one region-case-study has selected. */
  async listPoliciesForCaseStudy(
    regionCaseStudyId: string,
    viewer: Viewer,
  ): Promise<PolicyListItemDto[]> {
    const ids = await this.caseStudies.documentIdsFor(regionCaseStudyId, viewer);
    if (ids.length === 0) return [];
    return this.codebook.listPolicies(ids);
  }

  /** Exclude a file from a case study (unlink only; the analysis is kept). */
  excludeFileFromCaseStudy(
    regionCaseStudyId: string,
    documentId: string,
    viewer: Viewer,
  ): Promise<void> {
    return this.caseStudies.removeSelection(regionCaseStudyId, documentId, viewer);
  }

  getPolicyDetail(documentId: string): Promise<PolicyDetailDto | null> {
    return this.codebook.getPolicyDetail(documentId);
  }

  /** Save the user's note on a document; returns the saved note or null if unknown. */
  updateNote(documentId: string, note: string): Promise<string | null> {
    return this.codebook.updateNote(documentId, note);
  }

  /** Build the codebook filename for one region-case-study. */
  private caseStudyFilename(ctx: { country: string; regionName: string; caseStudyName: string }): string {
    const slug = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "") || "x";
    return `SkillResilience4EU_Gioia_Codebook_${slug(ctx.country)}_${slug(ctx.regionName)}_${slug(
      ctx.caseStudyName,
    )}.xlsx`;
  }

  /** One region-case-study's codebook as structured data (owner/admin only). */
  async getCodebookForCaseStudy(regionCaseStudyId: string, viewer: Viewer): Promise<CodebookDto> {
    const ctx = await this.caseStudies.getContext(regionCaseStudyId, viewer);
    const aggregate = await this.codebook.getCaseStudyAggregate(regionCaseStudyId);
    return this.codebook.getWorkbookData(ctx.documentIds, aggregate, this.caseStudyFilename(ctx));
  }

  /** One region-case-study's downloadable Excel + its filename (owner/admin only). */
  async generateCaseStudyWorkbook(
    regionCaseStudyId: string,
    viewer: Viewer,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const ctx = await this.caseStudies.getContext(regionCaseStudyId, viewer);
    const aggregate = await this.codebook.getCaseStudyAggregate(regionCaseStudyId);
    const buffer = await this.codebook.generateWorkbookBuffer(ctx.documentIds, aggregate);
    return { buffer, filename: this.caseStudyFilename(ctx) };
  }

  /** Freshness of a case study's aggregate vs its current file selection. */
  async getAggregateStatus(
    regionCaseStudyId: string,
    viewer: Viewer,
  ): Promise<CaseStudyAggregateStatusDto> {
    const ids = await this.caseStudies.documentIdsFor(regionCaseStudyId, viewer);
    return this.codebook.getAggregateStatus(regionCaseStudyId, ids);
  }

  /** Current model selection + the options the admin UI renders. */
  getSettings(): Promise<AnalysisSettingsResponseDto> {
    return this.settings.getSettingsResponse();
  }

  /** Cost-tracking report for the admin usage page. */
  getUsageReport(): Promise<UsageReportDto> {
    return this.usage.getReport();
  }

  getErrorLog(): Promise<AnalysisErrorDto[]> {
    return this.errors.list();
  }

  /** Read-only view of the system prompts used in the LLM calls (admin). */
  async getPrompts(): Promise<PromptsDto> {
    const settings = await this.settings.getSettings();
    return buildPromptView(settings.mode === "single" ? "single" : "staged");
  }

  /** Update the model selection (admin only). */
  updateSettings(patch: UpdateAnalysisSettingsDto): Promise<AnalysisSettingsDto> {
    return this.settings.updateSettings(patch);
  }

  /**
   * Synthesise aggregate dimensions for one region-case-study, over exactly the
   * files that region selected.
   */
  async aggregateForCaseStudy(
    regionCaseStudyId: string,
    viewer: Viewer,
  ): Promise<CrossDocumentAggregateDto> {
    const ids = await this.caseStudies.documentIdsFor(regionCaseStudyId, viewer);
    if (ids.length === 0) {
      throw new BadRequestException("This case study has no analysed files yet.");
    }
    const result = await this.aggregateDimensions(ids, regionCaseStudyId);
    // Persist so the case study's codebook is stable and downloadable.
    await this.codebook.saveCaseStudyAggregate(regionCaseStudyId, result);
    return result;
  }

  /**
   * Synthesise aggregate dimensions across the selected documents' themes. When
   * `regionCaseStudyId` is given, the call's cost is attributed to it.
   */
  async aggregateDimensions(
    documentIds: string[],
    regionCaseStudyId?: string,
  ): Promise<CrossDocumentAggregateDto> {
    const ids = [...new Set(documentIds.map((s) => s.trim()).filter(Boolean))];
    if (ids.length === 0) {
      throw new BadRequestException("Select at least one analysed document.");
    }
    const themes = await this.codebook.getThemesForDocuments(ids);
    if (themes.length === 0) {
      throw new BadRequestException(
        "The selected documents have no second-order themes to aggregate.",
      );
    }
    const { dimensions, usage } = await this.gioia.aggregateAcrossDocuments(ids, themes);
    // Ledger: attribute this file-less call's cost to the case study (if given).
    await this.usage.record({ kind: "aggregate", events: usage, regionCaseStudyId });
    const dtoDimensions = dimensions.map((d) => ({
      aggregateId: d.Aggregate_ID,
      aggregateDimension: d.Aggregate_Dimension,
      description: d.Description,
      secondOrderThemes: d.Second_Order_Themes,
      themeIds: d.Theme_IDs,
      examplePolicies: d.Example_Policies,
    }));
    const dimensionByTheme = new Map<string, (typeof dtoDimensions)[number]>();
    for (const d of dtoDimensions) {
      for (const themeId of splitIds(d.themeIds)) {
        if (!dimensionByTheme.has(themeId)) dimensionByTheme.set(themeId, d);
      }
    }
    const structureRows = (await this.codebook.getConceptThemeStructure(ids)).map((row) => {
      const dimension = dimensionByTheme.get(row.themeId);
      return {
        ...row,
        // Per-document coding has no aggregate dimension of its own now.
        sourceAggregateId: "",
        sourceAggregateDimension: "",
        aggregateId: dimension?.aggregateId ?? "",
        aggregateDimension: dimension?.aggregateDimension ?? "",
      };
    });

    return {
      documentIds: ids,
      themeCount: themes.length,
      dimensions: dtoDimensions,
      structureRows,
    };
  }

  /** Export a previously generated aggregate-dimension result as Excel. */
  generateAggregateWorkbook(result: CrossDocumentAggregateDto): Promise<Buffer> {
    return this.codebook.generateAggregateWorkbookBuffer(result);
  }
}

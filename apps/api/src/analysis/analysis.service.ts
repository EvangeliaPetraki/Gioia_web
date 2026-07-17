import { createHash } from "node:crypto";
import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import type {
  AnalysisSettingsDto,
  AnalysisSettingsResponseDto,
  AnalysisSummaryDto,
  CaseStudyAggregateStatusDto,
  CodebookDto,
  CrossDocumentAggregateDto,
  PolicyDetailDto,
  PolicyListItemDto,
  UpdateAnalysisSettingsDto,
} from "@gioia/dto";
import type { PromptsDto } from "@gioia/dto";
import { PdfService } from "./pdf.service";
import { GioiaService } from "./gioia.service";
import { CodebookService } from "./codebook.service";
import { CaseStudyService } from "./case-study.service";
import { SettingsService } from "./settings.service";
import { buildPromptView } from "./gioia.constants";
import type { Viewer } from "../auth/current-user.decorator";

const splitIds = (s: string) =>
  s
    .split(/[;,]/)
    .map((x) => x.trim())
    .filter(Boolean);

@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly pdf: PdfService,
    private readonly gioia: GioiaService,
    private readonly codebook: CodebookService,
    private readonly caseStudies: CaseStudyService,
  ) {}

  /**
   * Analyse an uploaded PDF within a region's case study. If the same file
   * (by content hash) was already analysed under this case-study *type* — even
   * for another region — that analysis is reused: it is linked into this case
   * study and the model is not re-run. Otherwise the file is analysed once,
   * stored under the case-study type, and linked.
   */
  async analyseDocument(
    fileName: string,
    buffer: Buffer,
    regionCaseStudyId: string,
    viewer: Viewer,
  ): Promise<AnalysisSummaryDto> {
    if (!regionCaseStudyId?.trim()) {
      throw new BadRequestException("Select a case study to upload into.");
    }
    try {
      const { regionCaseStudyId: rcsId, caseStudyTypeId } =
        await this.caseStudies.resolveCaseStudyType(regionCaseStudyId.trim(), viewer);
      const fileHash = createHash("sha256").update(buffer).digest("hex");

      // Reuse path: this file was already analysed under this case-study type.
      const existing = await this.codebook.findByHash(fileHash, caseStudyTypeId);
      if (existing) {
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
        };
      }

      // Fresh analysis, scoped to the case-study type for context reuse.
      const text = await this.pdf.extractText(buffer);
      const existingContext = await this.codebook.getExistingContext(caseStudyTypeId);
      const analysis = await this.gioia.analyse(text, fileName, existingContext);
      const { documentId, newThemes } = await this.codebook.append(analysis, fileName, {
        caseStudyTypeId,
        fileHash,
      });
      await this.caseStudies.linkSelection(rcsId, documentId, fileName);

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
      };
    } catch (e) {
      // Intentional 4xx/5xx (bad request, model unavailable, forbidden…) pass
      // through untouched. Anything else is an unexpected bug — log the full
      // stack (so it shows in the server console) and surface a real message
      // instead of a bare "Internal server error".
      if (e instanceof HttpException) throw e;
      this.logger.error(
        `analyseDocument failed for "${fileName}": ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
      );
      throw new ServiceUnavailableException(
        `Analysis failed: ${e instanceof Error ? e.message : "unexpected error"}`,
      );
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
    const result = await this.aggregateDimensions(ids);
    // Persist so the case study's codebook is stable and downloadable.
    await this.codebook.saveCaseStudyAggregate(regionCaseStudyId, result);
    return result;
  }

  /** Synthesise aggregate dimensions across the selected documents' themes. */
  async aggregateDimensions(documentIds: string[]): Promise<CrossDocumentAggregateDto> {
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
    const dimensions = await this.gioia.aggregateAcrossDocuments(ids, themes);
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

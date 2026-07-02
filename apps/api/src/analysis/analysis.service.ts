import { BadRequestException, Injectable } from "@nestjs/common";
import type {
  AnalysisSettingsDto,
  AnalysisSettingsResponseDto,
  AnalysisSummaryDto,
  CodebookDto,
  CrossDocumentAggregateDto,
  PolicyDetailDto,
  PolicyListItemDto,
  UpdateAnalysisSettingsDto,
} from "@gioia/dto";
import { PdfService } from "./pdf.service";
import { GioiaService } from "./gioia.service";
import { CodebookService } from "./codebook.service";
import { SettingsService } from "./settings.service";

const splitIds = (s: string) =>
  s
    .split(/[;,]/)
    .map((x) => x.trim())
    .filter(Boolean);

@Injectable()
export class AnalysisService {
  constructor(
    private readonly settings: SettingsService,
    private readonly pdf: PdfService,
    private readonly gioia: GioiaService,
    private readonly codebook: CodebookService,
  ) {}

  /** Extract text, run the Gioia analysis, append to the master codebook. */
  async analyseDocument(fileName: string, buffer: Buffer): Promise<AnalysisSummaryDto> {
    const text = await this.pdf.extractText(buffer);
    const existingContext = await this.codebook.getExistingContext();
    const analysis = await this.gioia.analyse(text, fileName, existingContext);
    const { documentId, newThemes } = await this.codebook.append(analysis, fileName);

    return {
      documentId,
      policyName: analysis.policy_metadata.Policy_Name,
      governanceLevel: analysis.policy_metadata.Governance_Level,
      counts: {
        excerpts: analysis.raw_data_extraction.length,
        firstOrderConcepts: analysis.first_order_concepts.length,
        secondOrderThemes: analysis.second_order_themes.length,
        aggregateDimensions: analysis.aggregate_dimensions.length,
        newThemes,
      },
      policySummary: analysis.policy_summary,
      workbookFilename: this.codebook.filename,
    };
  }

  listPolicies(): Promise<PolicyListItemDto[]> {
    return this.codebook.listPolicies();
  }

  getPolicyDetail(documentId: string): Promise<PolicyDetailDto | null> {
    return this.codebook.getPolicyDetail(documentId);
  }

  /** Save the user's note on a document; returns the saved note or null if unknown. */
  updateNote(documentId: string, note: string): Promise<string | null> {
    return this.codebook.updateNote(documentId, note);
  }

  getWorkbookData(): Promise<CodebookDto> {
    return this.codebook.getWorkbookData();
  }

  /** Generate the master Excel from the database (optionally limited to `docIds`). */
  generateWorkbook(docIds?: string[]): Promise<Buffer> {
    return this.codebook.generateWorkbookBuffer(docIds);
  }

  workbookFilename(): string {
    return this.codebook.filename;
  }

  /** Current model selection + the options the admin UI renders. */
  getSettings(): Promise<AnalysisSettingsResponseDto> {
    return this.settings.getSettingsResponse();
  }

  /** Update the model selection (admin only). */
  updateSettings(patch: UpdateAnalysisSettingsDto): Promise<AnalysisSettingsDto> {
    return this.settings.updateSettings(patch);
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
    const structureRows = (await this.codebook.getGioiaStructureForDocuments(ids)).map((row) => {
      const dimension = dimensionByTheme.get(row.themeId);
      return {
        ...row,
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

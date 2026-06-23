import { Injectable } from "@nestjs/common";
import type {
  AnalysisSummaryDto,
  CodebookDto,
  PolicyDetailDto,
  PolicyListItemDto,
} from "@gioia/dto";
import { PdfService } from "./pdf.service";
import { GioiaService } from "./gioia.service";
import { CodebookService } from "./codebook.service";

@Injectable()
export class AnalysisService {
  constructor(
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
}

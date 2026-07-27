/**
 * Admin cost-tracking (usage) report — `GET /api/analysis/usage`.
 *
 * Costs are in USD, computed per LLM call from a price table. Two totals matter:
 * `totalActualUsd` is real spend (each call counted once); the per-case-study
 * figures ATTRIBUTE each file's analysis cost to every case study that selected
 * it (even if that upload was a reuse/skip), so they show what each case study
 * would have cost if analysed independently — their sum can exceed actual spend.
 */

/** One LLM call in a file's analysis log. */
export interface UsageStageDto {
  stage: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** The full cost of analysing one file, broken down by call. */
export interface UsageDocumentDto {
  documentId: string;
  policyName: string;
  caseStudyType: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  stages: UsageStageDto[];
}

/** Attributed cost of one region-case-study (as if its files were independent). */
export interface UsageCaseStudyDto {
  regionCaseStudyId: string;
  label: string;
  fileCount: number;
  /** Sum of the case study's selected files' analysis costs (reuse included). */
  fileCostUsd: number;
  /** Cost of this case study's aggregate-dimension calls (file-less). */
  aggregateCostUsd: number;
  totalUsd: number;
}

export interface UsageReportDto {
  currency: "USD";
  /** Real money spent — every call counted once. */
  totalActualUsd: number;
  /** Sum of per-case-study totals (reused files counted per case study). */
  attributedTotalUsd: number;
  perCaseStudy: UsageCaseStudyDto[];
  perDocument: UsageDocumentDto[];
  /** Models that appeared with a known price / with no price (cost counted as 0). */
  pricedModels: string[];
  unpricedModels: string[];
}

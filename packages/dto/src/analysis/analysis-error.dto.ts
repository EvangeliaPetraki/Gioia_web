/**
 * Admin error log — `GET /api/analysis/errors`. One row per failed document
 * analysis (the pipeline already retries transient issues once internally;
 * this is what's left after that retry also failed), so the admin can see
 * *why* a specific upload failed without digging through server logs.
 */
export interface AnalysisErrorDto {
  id: string;
  createdAt: string;
  fileName: string;
  message: string;
  /** The model's raw (unparseable) output, when the failure was JSON-shaped. */
  rawOutput: string | null;
  caseStudyLabel: string | null;
}

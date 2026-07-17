import type { GovernanceLevel } from "./gioia.dto";

/**
 * Per-level item counts returned after analysing a document. A single document
 * is coded up to second-order themes only (aggregate dimensions are produced at
 * the case-study level), so there is no per-document aggregate-dimension count.
 */
export interface AnalysisCounts {
  excerpts: number;
  firstOrderConcepts: number;
  secondOrderThemes: number;
  /** Second-order themes newly introduced by this document (not already in the case study). */
  newThemes: number;
}

/** Response of POST /analysis/upload — mirrors the "chat response" required by WP5.2. */
export interface AnalysisSummaryDto {
  documentId: string;
  policyName: string;
  governanceLevel: GovernanceLevel | string;
  counts: AnalysisCounts;
  policySummary: string;
  /** Filename of the master codebook the analysis was appended to. */
  workbookFilename: string;
  /**
   * True when this file had already been analysed under the same case-study type
   * and the existing analysis was reused (linked) instead of re-running the model.
   */
  reused: boolean;
}

/** One row in the analysed-policies catalogue (GET /analysis/policies). */
export interface PolicyListItemDto {
  documentId: string;
  policyName: string;
  countryOrRegion: string;
  governanceLevel: string;
  dateAnalysed: string;
}

/** A first-order concept coded from one document, for the detail view. */
export interface FirstOrderConceptItemDto {
  conceptId: string;
  concept: string;
  excerpt: string;
  codingNotes: string;
}

/** A second-order theme coded from one document, for the detail view. */
export interface SecondOrderThemeItemDto {
  themeId: string;
  theme: string;
  /** Human-readable list of the first-order concepts that roll up into this theme. */
  firstOrderConcepts: string;
  exampleQuote: string;
}

/**
 * Full Gioia outcome for a single analysed document
 * (GET /analysis/policies/:documentId) — the first-order concepts and
 * second-order themes that came out of that policy.
 */
export interface PolicyDetailDto {
  documentId: string;
  policyName: string;
  firstOrderConcepts: FirstOrderConceptItemDto[];
  secondOrderThemes: SecondOrderThemeItemDto[];
}

/** One worksheet of the master codebook: its headers and rows (cells in column order). */
export interface CodebookSheetDto {
  name: string;
  columns: string[];
  rows: string[][];
}

/**
 * The whole master codebook as structured data (GET /analysis/codebook) —
 * mirrors the produced Excel: one entry per worksheet, in sheet order.
 */
export interface CodebookDto {
  filename: string;
  sheets: CodebookSheetDto[];
}

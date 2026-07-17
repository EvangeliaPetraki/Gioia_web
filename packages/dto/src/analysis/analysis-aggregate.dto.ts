import { ArrayNotEmpty, IsArray, IsString } from "class-validator";

/** POST /analysis/aggregate body (admin only) — the documents to aggregate over. */
export class ExtractAggregateDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  documentIds!: string[];
}

/** One aggregate dimension synthesised across the selected documents. */
export interface CrossDocAggregateDimensionDto {
  aggregateId: string;
  aggregateDimension: string;
  description: string;
  /** Semicolon-separated second-order theme labels grouped into this dimension. */
  secondOrderThemes: string;
  /** Semicolon-separated Theme_IDs. */
  themeIds: string;
  /** Semicolon-separated Document_IDs the grouped themes came from. */
  examplePolicies: string;
}

/** One Gioia data-structure row for the selected documents, mapped to the new cross-document dimension. */
export interface CrossDocumentGioiaStructureRowDto {
  documentId: string;
  conceptId: string;
  firstOrderConcept: string;
  themeId: string;
  secondOrderTheme: string;
  /** Aggregate dimension originally assigned inside the source document. */
  sourceAggregateId: string;
  sourceAggregateDimension: string;
  /** Newly synthesised aggregate dimension across the selected documents. */
  aggregateId: string;
  aggregateDimension: string;
}

/**
 * Freshness of a region-case-study's persisted aggregate vs its current files.
 * `generatedAt` is null when it has never been extracted; `staleCount` is how
 * many currently-selected files were not part of the last extraction.
 */
export interface CaseStudyAggregateStatusDto {
  generatedAt: string | null;
  documentCount: number;
  staleCount: number;
}

/** Result of a cross-document aggregate-dimension extraction. */
export interface CrossDocumentAggregateDto {
  documentIds: string[];
  /** Number of distinct second-order themes fed into the synthesis. */
  themeCount: number;
  dimensions: CrossDocAggregateDimensionDto[];
  structureRows: CrossDocumentGioiaStructureRowDto[];
}

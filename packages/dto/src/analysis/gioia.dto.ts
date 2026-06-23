/**
 * Shared contracts for the Gioia policy-analysis pipeline (WP5.2).
 * Used by the NestJS backend (response typing) and the Next.js dashboard.
 */

export const GOVERNANCE_LEVELS = [
  "Supranational-EU",
  "Supranational-other",
  "National",
  "Regional NUTS1",
  "Regional NUTS2",
  "Regional NUTS3",
  "Local",
  "Transnational",
] as const;

export type GovernanceLevel = (typeof GOVERNANCE_LEVELS)[number];

/** Policy metadata extracted in Step 1. */
export interface PolicyMetadata {
  Document_ID: string;
  Policy_Name: string;
  Country_or_Region: string;
  Governance_Level: GovernanceLevel | string;
  Policy_Year: string;
  Issuing_Actor: string;
  Policy_Type: string;
}

export interface RawExcerpt {
  Raw_ID: string;
  Section_Page: string;
  Excerpt_Text: string;
  Initial_Notes: string;
  Analytical_Flags: string;
}

export interface FirstOrderConcept {
  Concept_Instance_ID: string;
  Concept_ID: string;
  Raw_ID: string;
  Excerpt_Text: string;
  First_Order_Concept: string;
  Coding_Notes: string;
}

export interface SecondOrderTheme {
  Theme_ID: string;
  First_Order_Concept_IDs: string;
  First_Order_Concepts: string;
  Second_Order_Theme: string;
  Example_Quote: string;
}

export interface AggregateDimension {
  Aggregate_ID: string;
  Theme_IDs: string;
  Second_Order_Themes: string;
  Aggregate_Dimension: string;
  Description: string;
  Example_Policies: string;
}

export interface GioiaStructureRow {
  Concept_ID: string;
  First_Order_Concept: string;
  Theme_ID: string;
  Second_Order_Theme: string;
  Aggregate_ID: string;
  Aggregate_Dimension: string;
}

export interface ResearchQuestionMemo {
  RQ_Focus: string;
  Analytical_Memo: string;
}

/** The full structured analysis returned by the model for one policy document. */
export interface GioiaAnalysis {
  policy_metadata: PolicyMetadata;
  raw_data_extraction: RawExcerpt[];
  first_order_concepts: FirstOrderConcept[];
  second_order_themes: SecondOrderTheme[];
  aggregate_dimensions: AggregateDimension[];
  gioia_data_structure: GioiaStructureRow[];
  policy_summary: string;
  refinement_summary: string;
  research_question_memo: ResearchQuestionMemo;
}

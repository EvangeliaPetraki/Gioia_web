/**
 * Read-only view of the system prompts used in the LLM calls, for admin
 * transparency (`GET /api/analysis/prompts`). These are the instructions given
 * to the model; each call additionally includes the document text and the
 * existing codebook as context, which are not shown here.
 */

export interface PromptSectionDto {
  id: string;
  title: string;
  description: string;
  content: string;
}

export interface PromptGroupDto {
  title: string;
  description: string;
  /** True for the group matching the currently-active pipeline mode. */
  active: boolean;
  sections: PromptSectionDto[];
}

export interface PromptsDto {
  /** The pipeline mode currently selected in admin settings. */
  activeMode: "staged" | "single";
  groups: PromptGroupDto[];
}

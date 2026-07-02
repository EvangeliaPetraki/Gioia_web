import { IsIn, IsOptional, IsString } from "class-validator";

/**
 * Runtime-configurable model selection for the Gioia pipeline. Stored in the
 * database and edited by admins from the UI (no longer env-driven).
 */

/** Pipeline method. */
export const ANALYSIS_MODES = ["staged", "single"] as const;
export type AnalysisMode = (typeof ANALYSIS_MODES)[number];

/** Staged-mode model profiles (which model runs each tier). */
export const ANALYSIS_PROFILES = ["claude", "hybrid", "chutes"] as const;
export type AnalysisProfile = (typeof ANALYSIS_PROFILES)[number];

/** Claude reasoning-effort levels. */
export const MODEL_EFFORTS = ["low", "medium", "high", "max"] as const;
export type ModelEffort = (typeof MODEL_EFFORTS)[number];

export interface ProfileOption {
  value: AnalysisProfile;
  label: string;
  description: string;
}

/** Profiles shown in the admin UI (staged mode). */
export const PROFILE_OPTIONS: ProfileOption[] = [
  {
    value: "claude",
    label: "Claude (balanced)",
    description: "Sonnet extract · Haiku concepts · Sonnet reasoning",
  },
  {
    value: "hybrid",
    label: "Hybrid",
    description: "Open models extract/concepts · Claude Opus reasoning",
  },
  {
    value: "chutes",
    label: "Chutes (all open)",
    description: "DeepSeek · Qwen · GLM-5.2",
  },
];

export interface ModelOption {
  /** `provider:model` reference used by the backend. */
  value: string;
  label: string;
  provider: "chutes" | "anthropic";
}

/** Models selectable for the single-call method. */
export const SINGLE_MODEL_OPTIONS: ModelOption[] = [
  { value: "chutes:zai-org/GLM-5-TEE", label: "GLM-5 (Chutes) — the original single model", provider: "chutes" },
  { value: "chutes:zai-org/GLM-5.2-TEE", label: "GLM-5.2 (Chutes) — strongest open model", provider: "chutes" },
  { value: "chutes:deepseek-ai/DeepSeek-V3.2-TEE", label: "DeepSeek-V3.2 (Chutes)", provider: "chutes" },
  { value: "chutes:moonshotai/Kimi-K2.6-TEE", label: "Kimi K2.6 (Chutes)", provider: "chutes" },
  { value: "anthropic:claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic" },
  { value: "anthropic:claude-opus-4-8", label: "Claude Opus 4.8", provider: "anthropic" },
];

/** The active analysis configuration. */
export interface AnalysisSettingsDto {
  mode: AnalysisMode;
  /** Used when `mode === "staged"`. */
  profile: AnalysisProfile;
  /** `provider:model` used when `mode === "single"`. */
  singleModel: string;
  /** Claude reasoning effort (staged reasoning tier and single-call Claude models). */
  effort: ModelEffort;
}

/** GET /analysis/settings — current settings plus the choices the UI renders. */
export interface AnalysisSettingsResponseDto {
  settings: AnalysisSettingsDto;
  options: {
    modes: readonly AnalysisMode[];
    profiles: ProfileOption[];
    singleModels: ModelOption[];
    efforts: readonly ModelEffort[];
  };
}

/** PATCH /analysis/settings body (admin only). Every field optional (partial update). */
export class UpdateAnalysisSettingsDto {
  @IsOptional()
  @IsIn(ANALYSIS_MODES as unknown as string[])
  mode?: AnalysisMode;

  @IsOptional()
  @IsIn(ANALYSIS_PROFILES as unknown as string[])
  profile?: AnalysisProfile;

  @IsOptional()
  @IsString()
  singleModel?: string;

  @IsOptional()
  @IsIn(MODEL_EFFORTS as unknown as string[])
  effort?: ModelEffort;
}

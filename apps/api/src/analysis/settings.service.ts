import { BadRequestException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ANALYSIS_MODES,
  ANALYSIS_PROFILES,
  MODEL_EFFORTS,
  PROFILE_OPTIONS,
  SINGLE_MODEL_OPTIONS,
  type AnalysisMode,
  type AnalysisProfile,
  type AnalysisSettingsDto,
  type AnalysisSettingsResponseDto,
  type ModelEffort,
} from "@gioia/dto";
import { PrismaService } from "../prisma/prisma.service";

const SINGLETON = "singleton";

/**
 * Source of truth for the pipeline's model selection. Persisted as a single DB
 * row and edited by admins from the UI. Falls back to env values (the former
 * config keys) only to seed the initial defaults when no row exists yet.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** The active configuration (DB row, or env-seeded defaults if none). */
  async getSettings(): Promise<AnalysisSettingsDto> {
    const row = await this.prisma.analysisSetting.findUnique({ where: { id: SINGLETON } });
    if (!row) return this.defaults();
    return {
      mode: this.coerce(row.mode, ANALYSIS_MODES, "staged") as AnalysisMode,
      profile: this.coerce(row.profile, ANALYSIS_PROFILES, "claude") as AnalysisProfile,
      singleModel: this.coerceModel(row.singleModel),
      effort: this.coerce(row.effort, MODEL_EFFORTS, "medium") as ModelEffort,
    };
  }

  /** Update the configuration (admin only); validates every field. */
  async updateSettings(patch: Partial<AnalysisSettingsDto>): Promise<AnalysisSettingsDto> {
    if (patch.singleModel && !SINGLE_MODEL_OPTIONS.some((o) => o.value === patch.singleModel)) {
      throw new BadRequestException(`Unknown model "${patch.singleModel}".`);
    }
    const merged = { ...(await this.getSettings()), ...patch };
    await this.prisma.analysisSetting.upsert({
      where: { id: SINGLETON },
      create: { id: SINGLETON, ...merged },
      update: merged,
    });
    return merged;
  }

  /** Current settings + the choices the admin UI renders. */
  async getSettingsResponse(): Promise<AnalysisSettingsResponseDto> {
    return {
      settings: await this.getSettings(),
      options: {
        modes: ANALYSIS_MODES,
        profiles: PROFILE_OPTIONS,
        singleModels: SINGLE_MODEL_OPTIONS,
        efforts: MODEL_EFFORTS,
      },
    };
  }

  private defaults(): AnalysisSettingsDto {
    return {
      mode: this.coerce(this.config.get<string>("PIPELINE_MODE"), ANALYSIS_MODES, "staged") as AnalysisMode,
      profile: this.coerce(this.config.get<string>("MODEL_PROFILE"), ANALYSIS_PROFILES, "claude") as AnalysisProfile,
      singleModel: this.coerceModel(this.config.get<string>("SINGLE_MODEL")),
      effort: this.coerce(this.config.get<string>("MODEL_EFFORT"), MODEL_EFFORTS, "medium") as ModelEffort,
    };
  }

  private coerce(value: string | undefined | null, allowed: readonly string[], fallback: string): string {
    const v = (value ?? "").toLowerCase();
    return allowed.includes(v) ? v : fallback;
  }

  private coerceModel(value: string | undefined | null): string {
    return value && SINGLE_MODEL_OPTIONS.some((o) => o.value === value)
      ? value
      : "chutes:zai-org/GLM-5-TEE";
  }
}

import { Injectable, Logger } from "@nestjs/common";
import type { AnalysisErrorDto } from "@gioia/dto";
import { PrismaService } from "../prisma/prisma.service";

// A generous ceiling, not a real limit: a model's max output (64K tokens for
// Claude Sonnet) is at most ~300K chars for heavily non-English text. The
// point is bounding a pathological runaway, not trimming normal failures —
// the actual parse-failure point (see gioia.service.ts's parseJson) is often
// deep inside the output, so cutting this low hides exactly what the admin
// needs to see.
const MAX_RAW_OUTPUT_CHARS = 300_000;
const MAX_LISTED = 200;

/**
 * Append-only log of failed document analyses, for the admin error-inspection
 * page. A pipeline failure already gets one repair retry inside GioiaService
 * (see runStage); this records what was left after that retry also failed, so
 * an admin can see the model's actual raw output instead of just the short
 * HTTP error message the uploader saw.
 */
@Injectable()
export class AnalysisErrorService {
  private readonly logger = new Logger(AnalysisErrorService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Best-effort: a logging failure must never mask the original error. */
  async record(params: {
    fileName: string;
    message: string;
    rawOutput?: string | null;
    regionCaseStudyId?: string;
  }): Promise<void> {
    try {
      await this.prisma.analysisError.create({
        data: {
          fileName: params.fileName,
          message: params.message,
          rawOutput: params.rawOutput?.slice(0, MAX_RAW_OUTPUT_CHARS) ?? null,
          regionCaseStudyId: params.regionCaseStudyId ?? null,
        },
      });
    } catch (e) {
      this.logger.warn(`Error recording failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Most recent failures first, for the admin error log. */
  async list(): Promise<AnalysisErrorDto[]> {
    const [rows, rcsList] = await Promise.all([
      this.prisma.analysisError.findMany({
        orderBy: { createdAt: "desc" },
        take: MAX_LISTED,
      }),
      this.prisma.regionCaseStudy.findMany({
        include: { region: { select: { country: true, name: true } }, caseStudyType: { select: { name: true } } },
      }),
    ]);
    const labelById = new Map(
      rcsList.map((rcs) => [rcs.id, `${rcs.region.country} · ${rcs.region.name} · ${rcs.caseStudyType.name}`]),
    );
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      fileName: r.fileName,
      message: r.message,
      rawOutput: r.rawOutput,
      caseStudyLabel: r.regionCaseStudyId ? (labelById.get(r.regionCaseStudyId) ?? null) : null,
    }));
  }
}

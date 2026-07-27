import { Injectable, Logger } from "@nestjs/common";
import type { UsageReportDto, UsageStageDto } from "@gioia/dto";
import { PrismaService } from "../prisma/prisma.service";
import { MODEL_PRICES, computeCostUsd, type StageUsage } from "./pricing";

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Cost ledger. Records the token usage of every LLM call and reports it for the
 * admin usage page: real total spend, per-case-study *attributed* cost (each
 * file's analysis cost counted for every case study that selected it — reuse
 * included), and a per-file breakdown of every call.
 */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persist the token usage of one analysis (per file) or one aggregate run (per
   * case study). Best-effort: a recording failure must never break the pipeline.
   */
  async record(params: {
    kind: "analysis" | "aggregate";
    events: StageUsage[];
    documentId?: string;
    regionCaseStudyId?: string;
    caseStudyTypeId?: string;
  }): Promise<void> {
    if (params.events.length === 0) return;
    try {
      await this.prisma.usageEvent.createMany({
        data: params.events.map((e) => ({
          kind: params.kind,
          stage: e.stage,
          provider: e.provider,
          model: e.model,
          inputTokens: e.inputTokens,
          outputTokens: e.outputTokens,
          costUsd: computeCostUsd(e.model, e.inputTokens, e.outputTokens),
          documentId: params.documentId ?? null,
          regionCaseStudyId: params.regionCaseStudyId ?? null,
          caseStudyTypeId: params.caseStudyTypeId ?? null,
        })),
      });
    } catch (e) {
      this.logger.warn(`Usage recording failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** The full cost report for the admin usage page. */
  async getReport(): Promise<UsageReportDto> {
    const [events, docs, rcsList] = await Promise.all([
      this.prisma.usageEvent.findMany({ orderBy: { createdAt: "asc" } }),
      this.prisma.analyzedDocument.findMany({
        select: { documentId: true, policyName: true, caseStudyType: { select: { name: true } } },
      }),
      this.prisma.regionCaseStudy.findMany({
        include: {
          region: { select: { country: true, name: true } },
          caseStudyType: { select: { name: true } },
          selections: { select: { documentId: true } },
        },
      }),
    ]);

    // Aggregate per document (analysis calls) and per region-case-study (aggregate calls).
    const perDoc = new Map<
      string,
      { input: number; output: number; cost: number; stages: UsageStageDto[] }
    >();
    const aggByRcs = new Map<string, number>();
    let totalActualUsd = 0;

    for (const e of events) {
      totalActualUsd += e.costUsd;
      if (e.documentId) {
        const d = perDoc.get(e.documentId) ?? { input: 0, output: 0, cost: 0, stages: [] };
        d.input += e.inputTokens;
        d.output += e.outputTokens;
        d.cost += e.costUsd;
        d.stages.push({
          stage: e.stage,
          provider: e.provider,
          model: e.model,
          inputTokens: e.inputTokens,
          outputTokens: e.outputTokens,
          costUsd: round(e.costUsd),
        });
        perDoc.set(e.documentId, d);
      }
      if (e.kind === "aggregate" && e.regionCaseStudyId) {
        aggByRcs.set(e.regionCaseStudyId, (aggByRcs.get(e.regionCaseStudyId) ?? 0) + e.costUsd);
      }
    }

    const docMeta = new Map(docs.map((d) => [d.documentId, d]));

    const perDocument = [...perDoc.entries()]
      .map(([documentId, d]) => ({
        documentId,
        policyName: docMeta.get(documentId)?.policyName ?? "",
        caseStudyType: docMeta.get(documentId)?.caseStudyType?.name ?? "",
        inputTokens: d.input,
        outputTokens: d.output,
        costUsd: round(d.cost),
        stages: d.stages,
      }))
      .sort((a, b) => b.costUsd - a.costUsd);

    // Attributed per case study: file costs (reuse included) + its aggregate calls.
    const perCaseStudy = rcsList
      .map((rcs) => {
        const fileCost = rcs.selections.reduce(
          (s, sel) => s + (perDoc.get(sel.documentId)?.cost ?? 0),
          0,
        );
        const aggregateCost = aggByRcs.get(rcs.id) ?? 0;
        return {
          regionCaseStudyId: rcs.id,
          label: `${rcs.region.country} · ${rcs.region.name} · ${rcs.caseStudyType.name}`,
          fileCount: rcs.selections.length,
          fileCostUsd: round(fileCost),
          aggregateCostUsd: round(aggregateCost),
          totalUsd: round(fileCost + aggregateCost),
        };
      })
      .sort((a, b) => b.totalUsd - a.totalUsd);

    const attributedTotalUsd = round(perCaseStudy.reduce((s, c) => s + c.totalUsd, 0));

    const modelsSeen = [...new Set(events.map((e) => e.model))];
    return {
      currency: "USD",
      totalActualUsd: round(totalActualUsd),
      attributedTotalUsd,
      perCaseStudy,
      perDocument,
      pricedModels: modelsSeen.filter((m) => MODEL_PRICES[m]),
      unpricedModels: modelsSeen.filter((m) => !MODEL_PRICES[m]),
    };
  }
}

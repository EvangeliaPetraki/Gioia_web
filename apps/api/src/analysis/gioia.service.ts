import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  AggregateDimension,
  FirstOrderConcept,
  GioiaAnalysis,
  GioiaStructureRow,
  PolicyMetadata,
  RawExcerpt,
  ResearchQuestionMemo,
  SecondOrderTheme,
} from "@gioia/dto";
import { GOVERNANCE_LEVELS } from "@gioia/dto";
import {
  GIOIA_OUTPUT_CONTRACT,
  GIOIA_SYSTEM_PROMPT,
  STAGE_SYSTEM,
  type ExistingContext,
} from "./gioia.constants";

type Json = Record<string, unknown>;

const INITIAL_NOTE_OPTIONS = [
  "Labour-market challenge framing",
  "Adjustment strategy",
  "Governance coordination",
  "Coherence signal",
  "Territorial-place-sensitive response",
  "Left-behind risk",
  "Implementation constraint",
  "Other relevant issue",
];

const FLAG_OPTIONS = [
  "[TENSION]",
  "[ABSENCE]",
  "[IMPLEMENTATION LOGIC: WEAK OPERATIONALISATION]",
  "[PLACE-SENSITIVE SIGNAL]",
  "[TERRITORIAL LOGIC: LIMITED DIFFERENTIATION]",
];

/**
 * Each stage is assigned a "tier": extraction (stage 1), concept coding (stage 2),
 * or reasoning/writing (stages 3-5, and single-mode). `MODEL_PROFILE` maps the
 * tiers to concrete models across providers.
 */
type Tier = "extract" | "concepts" | "reason";
interface ModelRef {
  provider: "anthropic" | "chutes";
  model: string;
}

const PROFILES: Record<string, Record<Tier, ModelRef>> = {
  // All Claude (default): faithful extraction on Sonnet, cheap high-volume
  // concept coding on Haiku, strong reasoning/writing on Sonnet. Override with
  // MODEL_REASON=claude-opus-4-8 for top-tier reasoning at higher cost.
  claude: {
    extract: { provider: "anthropic", model: "claude-sonnet-4-6" },
    concepts: { provider: "anthropic", model: "claude-haiku-4-5" },
    reason: { provider: "anthropic", model: "claude-sonnet-4-6" },
  },
  // Hybrid: cheap open models on the high-throughput stages, Claude Opus for
  // the judgement/writing stages.
  hybrid: {
    extract: { provider: "chutes", model: "deepseek-ai/DeepSeek-V3.2-TEE" },
    concepts: { provider: "chutes", model: "Qwen/Qwen3-32B-TEE" },
    reason: { provider: "anthropic", model: "claude-opus-4-8" },
  },
  // All Chutes (open models only) — cheapest.
  chutes: {
    extract: { provider: "chutes", model: "deepseek-ai/DeepSeek-V3.2-TEE" },
    concepts: { provider: "chutes", model: "Qwen/Qwen3-32B-TEE" },
    reason: { provider: "chutes", model: "zai-org/GLM-5.2-TEE" },
  },
};

const OVERRIDE_ENV: Record<Tier, string> = {
  extract: "MODEL_EXTRACT",
  concepts: "MODEL_CONCEPTS",
  reason: "MODEL_REASON",
};

@Injectable()
export class GioiaService {
  private readonly logger = new Logger(GioiaService.name);
  private client: OpenAI | null = null;
  private anthropic: Anthropic | null = null;

  constructor(private readonly config: ConfigService) {}

  private getClient(): OpenAI {
    const apiKey = this.config.get<string>("CHUTES_API_KEY");
    if (!apiKey) {
      throw new ServiceUnavailableException(
        "CHUTES_API_KEY is not configured. Add it to apps/api/.env to enable analysis.",
      );
    }
    if (!this.client) {
      this.client = new OpenAI({
        apiKey,
        baseURL: this.config.get<string>("CHUTES_BASE_URL") ?? "https://llm.chutes.ai/v1",
        timeout: 600_000, // analysis can take minutes
        maxRetries: 1,
      });
    }
    return this.client;
  }

  private getAnthropic(): Anthropic {
    const apiKey = this.config.get<string>("ANTHROPIC_API_KEY");
    if (!apiKey) {
      throw new ServiceUnavailableException(
        "ANTHROPIC_API_KEY is not configured. Add it to apps/api/.env to use a Claude model " +
          "(MODEL_PROFILE=claude or hybrid).",
      );
    }
    if (!this.anthropic) {
      this.anthropic = new Anthropic({ apiKey, timeout: 600_000, maxRetries: 1 });
    }
    return this.anthropic;
  }

  /** Resolve which provider + model to use for a tier, honouring per-tier overrides. */
  private resolveModel(tier: Tier): ModelRef {
    const profileName = (this.config.get<string>("MODEL_PROFILE") ?? "claude").toLowerCase();
    const profile = PROFILES[profileName] ?? PROFILES.claude;
    const override = this.config.get<string>(OVERRIDE_ENV[tier])?.trim();
    return override ? parseModelRef(override) : profile[tier];
  }

  /**
   * Run the full Gioia analysis on one policy document. Dispatches on
   * `PIPELINE_MODE`: "staged" (default-able multi-call pipeline with per-stage
   * validation) or "single" (the legacy one-shot call, kept as a fallback).
   */
  async analyse(policyText: string, fileName: string, existing: ExistingContext): Promise<GioiaAnalysis> {
    const mode = (this.config.get<string>("PIPELINE_MODE") ?? "single").toLowerCase();
    return mode === "staged"
      ? this.analyseStaged(policyText, fileName, existing)
      : this.analyseSingle(policyText, fileName, existing);
  }

  /**
   * Render only the requested levels of the existing codebook as prompt text.
   * Each stage receives just the vocabulary it can reuse, instead of the whole
   * codebook — smaller prompts and better reuse focus (Step 7).
   */
  private contextSection(
    existing: ExistingContext,
    include: { concepts?: boolean; themes?: boolean; dimensions?: boolean },
  ): string {
    const head = existing.isEmpty
      ? "The master codebook is currently empty — this is the first document; establish the initial code structure."
      : `Documents already coded: ${existing.documentIds.join(", ")}`;
    const blocks = [head];
    if (include.concepts) blocks.push(codesSection("Existing first-order concepts:", existing.concepts));
    if (include.themes) blocks.push(codesSection("Existing second-order themes:", existing.themes));
    if (include.dimensions) blocks.push(codesSection("Existing aggregate dimensions:", existing.dimensions));
    return blocks.join("\n\n");
  }

  // ── Staged pipeline ────────────────────────────────────────────────────────

  private async analyseStaged(
    policyText: string,
    fileName: string,
    existing: ExistingContext,
  ): Promise<GioiaAnalysis> {
    // Each stage gets only the codebook level it reuses.
    const conceptCtx = this.contextSection(existing, { concepts: true });
    const themeCtx = this.contextSection(existing, { themes: true });
    const dimensionCtx = this.contextSection(existing, { dimensions: true });
    const synthesisCtx = this.contextSection(existing, { themes: true, dimensions: true });

    // Stage 1 — metadata + raw excerpts + policy summary (no prior codes needed)
    const s1 = await this.runStage(
      "extract",
      STAGE_SYSTEM.metadata,
      () => this.stage1User(fileName, policyText),
      (j) => this.validateStage1(j),
      "stage1-metadata",
    );
    const meta = s1.policy_metadata as PolicyMetadata;
    const documentId = String(meta.Document_ID ?? "").trim() || "DOC_01";
    const rawExcerpts: RawExcerpt[] = asArray(s1.raw_data_extraction).map((r) => ({
      Raw_ID: str(r.Raw_ID),
      Section_Page: str(r.Section_Page),
      Excerpt_Text: str(r.Excerpt_Text),
      Initial_Notes: str(r.Initial_Notes),
      Analytical_Flags: "",
    }));
    const policySummary = str(s1.policy_summary);

    // Stage 2 — first-order concepts
    const s2 = await this.runStage(
      "concepts",
      STAGE_SYSTEM.concepts,
      () => this.stage2User(documentId, rawExcerpts, conceptCtx),
      (j) => this.validateStage2(j, rawExcerpts),
      "stage2-concepts",
    );
    const concepts: FirstOrderConcept[] = asArray(s2.first_order_concepts).map((c) => ({
      Concept_Instance_ID: str(c.Concept_Instance_ID),
      Concept_ID: str(c.Concept_ID),
      Raw_ID: str(c.Raw_ID),
      Excerpt_Text: str(c.Excerpt_Text),
      First_Order_Concept: str(c.First_Order_Concept),
      Coding_Notes: str(c.Coding_Notes),
    }));

    // Stage 3 — second-order themes
    const s3 = await this.runStage(
      "reason",
      STAGE_SYSTEM.themes,
      () => this.stage3User(documentId, concepts, themeCtx),
      (j) => this.validateStage3(j, concepts),
      "stage3-themes",
    );
    const themes: SecondOrderTheme[] = asArray(s3.second_order_themes).map((t) => ({
      Theme_ID: str(t.Theme_ID),
      First_Order_Concept_IDs: str(t.First_Order_Concept_IDs),
      First_Order_Concepts: str(t.First_Order_Concepts),
      Second_Order_Theme: str(t.Second_Order_Theme),
      Example_Quote: str(t.Example_Quote),
    }));

    // Stage 4 — aggregate dimensions
    const s4 = await this.runStage(
      "reason",
      STAGE_SYSTEM.dimensions,
      () => this.stage4User(documentId, themes, dimensionCtx),
      (j) => this.validateStage4(j, themes),
      "stage4-dimensions",
    );
    const dimensions: AggregateDimension[] = asArray(s4.aggregate_dimensions).map((a) => ({
      Aggregate_ID: str(a.Aggregate_ID),
      Theme_IDs: str(a.Theme_IDs),
      Second_Order_Themes: str(a.Second_Order_Themes),
      Aggregate_Dimension: str(a.Aggregate_Dimension),
      Description: str(a.Description),
      Example_Policies: str(a.Example_Policies) || documentId,
    }));

    // Stage 5 — cross-document flags + refinement summary + RQ memo
    const s5 = await this.runStage(
      "reason",
      STAGE_SYSTEM.synthesis,
      () => this.stage5User(documentId, meta, rawExcerpts, themes, dimensions, synthesisCtx),
      (j) => this.validateStage5(j, rawExcerpts),
      "stage5-synthesis",
    );
    const flagsByRaw = new Map<string, string>();
    for (const f of asArray(s5.analytical_flags)) {
      const id = str(f.Raw_ID);
      const flags = Array.isArray(f.Flags) ? f.Flags.map(String).join("; ") : str(f.Flags);
      if (id) flagsByRaw.set(id, flags);
    }
    for (const r of rawExcerpts) r.Analytical_Flags = flagsByRaw.get(r.Raw_ID) ?? "";
    const memoRaw = (s5.research_question_memo ?? {}) as Json;
    const researchQuestionMemo: ResearchQuestionMemo = {
      RQ_Focus: str(memoRaw.RQ_Focus),
      Analytical_Memo: str(memoRaw.Analytical_Memo),
    };

    // Step 6 — assemble the Gioia data structure deterministically in code.
    const gioiaStructure = this.buildDataStructure(concepts, themes, dimensions);

    this.logger.log(
      `Staged analysis complete for ${documentId}: ${rawExcerpts.length} excerpts, ` +
        `${concepts.length} concepts, ${themes.length} themes, ${dimensions.length} dimensions.`,
    );

    return {
      policy_metadata: meta,
      raw_data_extraction: rawExcerpts,
      first_order_concepts: concepts,
      second_order_themes: themes,
      aggregate_dimensions: dimensions,
      gioia_data_structure: gioiaStructure,
      policy_summary: policySummary,
      refinement_summary: str(s5.refinement_summary),
      research_question_memo: researchQuestionMemo,
    };
  }

  /** Run one stage, validate, repair once on failure, then fail loudly. */
  private async runStage(
    tier: Tier,
    system: string,
    buildUser: () => string,
    validate: (j: Json) => string[],
    label: string,
  ): Promise<Json> {
    const user = buildUser();
    let parsed = await this.callModel(system, user, label, tier);
    let errs = validate(parsed);
    if (errs.length === 0) return parsed;

    this.logger.warn(`${label}: ${errs.length} validation issue(s); repairing. First: ${errs[0]}`);
    const repairUser = `${user}\n\nA PREVIOUS ATTEMPT FAILED THESE VALIDATION CHECKS:\n- ${errs.join(
      "\n- ",
    )}\n\nReturn a corrected JSON object that fixes every issue. Output JSON only.`;
    parsed = await this.callModel(system, repairUser, `${label}-repair`, tier);
    errs = validate(parsed);
    if (errs.length === 0) return parsed;

    throw new ServiceUnavailableException(
      `${label} failed validation after repair: ${errs.slice(0, 6).join("; ")}`,
    );
  }

  // ── Per-stage user messages ─────────────────────────────────────────────────

  private stage1User(fileName: string, policyText: string): string {
    return [
      `UPLOADED FILE NAME: ${fileName}`,
      `Derive the Document_ID from this file name where it already encodes one (e.g. "EU_01.pdf" -> "EU_01").`,
      "",
      "POLICY DOCUMENT TEXT:",
      "<<<BEGIN POLICY TEXT>>>",
      policyText,
      "<<<END POLICY TEXT>>>",
    ].join("\n");
  }

  private stage2User(documentId: string, excerpts: RawExcerpt[], existingContext: string): string {
    return [
      `DOCUMENT_ID: ${documentId}`,
      "",
      "EXISTING MASTER CODEBOOK (reuse a Concept_ID only where wording & meaning match closely):",
      existingContext,
      "",
      "RAW EXCERPTS TO CODE (produce 1-3 first-order concepts per excerpt; use each Raw_ID verbatim):",
      JSON.stringify(excerpts.map((r) => ({ Raw_ID: r.Raw_ID, Excerpt_Text: r.Excerpt_Text }))),
    ].join("\n");
  }

  private stage3User(documentId: string, concepts: FirstOrderConcept[], existingContext: string): string {
    const distinct = dedupeBy(concepts, (c) => c.Concept_ID).map((c) => ({
      Concept_ID: c.Concept_ID,
      First_Order_Concept: c.First_Order_Concept,
    }));
    return [
      `DOCUMENT_ID: ${documentId}`,
      "",
      "EXISTING MASTER CODEBOOK (prefer reusing a Theme_ID on substantial overlap):",
      existingContext,
      "",
      "FIRST-ORDER CONCEPTS TO GROUP INTO THEMES (use these Concept_IDs verbatim):",
      JSON.stringify(distinct),
    ].join("\n");
  }

  private stage4User(documentId: string, themes: SecondOrderTheme[], existingContext: string): string {
    return [
      `DOCUMENT_ID: ${documentId}`,
      "",
      "EXISTING MASTER CODEBOOK (keep dimensions stable; reuse an Aggregate_ID where possible):",
      existingContext,
      "",
      "SECOND-ORDER THEMES TO GROUP INTO AGGREGATE DIMENSIONS (use these Theme_IDs verbatim):",
      JSON.stringify(themes.map((t) => ({ Theme_ID: t.Theme_ID, Second_Order_Theme: t.Second_Order_Theme }))),
    ].join("\n");
  }

  private stage5User(
    documentId: string,
    meta: PolicyMetadata,
    excerpts: RawExcerpt[],
    themes: SecondOrderTheme[],
    dimensions: AggregateDimension[],
    existingContext: string,
  ): string {
    return [
      `DOCUMENT_ID: ${documentId}`,
      `POLICY: ${str(meta.Policy_Name)} (${str(meta.Country_or_Region)}, ${String(meta.Governance_Level)})`,
      "",
      "EXISTING MASTER CODEBOOK (for judging what is reused vs newly introduced, and TENSION/ABSENCE):",
      existingContext,
      "",
      "THIS DOCUMENT'S CODING:",
      "Excerpts:",
      JSON.stringify(
        excerpts.map((r) => ({ Raw_ID: r.Raw_ID, Initial_Notes: r.Initial_Notes, Excerpt_Text: r.Excerpt_Text })),
      ),
      "Second-order themes:",
      JSON.stringify(themes.map((t) => ({ Theme_ID: t.Theme_ID, Second_Order_Theme: t.Second_Order_Theme }))),
      "Aggregate dimensions:",
      JSON.stringify(
        dimensions.map((d) => ({ Aggregate_ID: d.Aggregate_ID, Aggregate_Dimension: d.Aggregate_Dimension })),
      ),
    ].join("\n");
  }

  // ── Per-stage validation (errors → repair-retry → throw) ────────────────────

  private validateStage1(j: Json): string[] {
    const errs: string[] = [];
    const meta = j.policy_metadata as Json | undefined;
    if (!meta || typeof meta !== "object") errs.push("policy_metadata is missing.");
    else {
      if (!str(meta.Document_ID)) errs.push("policy_metadata.Document_ID is empty.");
      const gl = String(meta.Governance_Level ?? "");
      if (!(GOVERNANCE_LEVELS as readonly string[]).includes(gl)) {
        errs.push(`Governance_Level "${gl}" is not one of: ${GOVERNANCE_LEVELS.join(", ")}.`);
      }
    }
    const rows = asArray(j.raw_data_extraction);
    if (rows.length === 0) errs.push("raw_data_extraction is empty.");
    const ids = new Set<string>();
    for (const r of rows) {
      const id = str(r.Raw_ID);
      if (!/_RAW_\d+/.test(id)) errs.push(`Raw_ID "${id}" is missing or malformed (expected {Document_ID}_RAW_001).`);
      if (ids.has(id)) errs.push(`Duplicate Raw_ID "${id}".`);
      ids.add(id);
      if (!str(r.Excerpt_Text)) errs.push(`Excerpt_Text is empty for ${id}.`);
      if (!INITIAL_NOTE_OPTIONS.includes(str(r.Initial_Notes))) {
        errs.push(`Initial_Notes "${str(r.Initial_Notes)}" for ${id} is not an allowed value.`);
      }
    }
    if (!str(j.policy_summary)) errs.push("policy_summary is empty.");
    return errs;
  }

  private validateStage2(j: Json, excerpts: RawExcerpt[]): string[] {
    const errs: string[] = [];
    const rawIds = new Set(excerpts.map((r) => r.Raw_ID));
    const concepts = asArray(j.first_order_concepts);
    if (concepts.length === 0) errs.push("first_order_concepts is empty.");
    const instanceIds = new Set<string>();
    const covered = new Set<string>();
    for (const c of concepts) {
      const cid = str(c.Concept_ID);
      const iid = str(c.Concept_Instance_ID);
      const rid = str(c.Raw_ID);
      if (!/^FOC_\d+/.test(cid)) errs.push(`Concept_ID "${cid}" is malformed (expected FOC_1).`);
      if (!iid) errs.push("A concept is missing Concept_Instance_ID.");
      if (instanceIds.has(iid)) errs.push(`Duplicate Concept_Instance_ID "${iid}".`);
      instanceIds.add(iid);
      if (!rawIds.has(rid)) errs.push(`Concept references unknown Raw_ID "${rid}".`);
      else covered.add(rid);
      if (!str(c.First_Order_Concept)) errs.push(`First_Order_Concept is empty for ${iid}.`);
    }
    for (const r of excerpts) {
      if (!covered.has(r.Raw_ID)) errs.push(`Excerpt ${r.Raw_ID} has no first-order concept.`);
    }
    return errs;
  }

  private validateStage3(j: Json, concepts: FirstOrderConcept[]): string[] {
    const errs: string[] = [];
    const conceptIds = new Set(concepts.map((c) => c.Concept_ID));
    const themes = asArray(j.second_order_themes);
    if (themes.length === 0) errs.push("second_order_themes is empty.");
    const themeIds = new Set<string>();
    const grouped = new Set<string>();
    for (const t of themes) {
      const tid = str(t.Theme_ID);
      if (!/^THM_\d+/.test(tid)) errs.push(`Theme_ID "${tid}" is malformed (expected THM_1).`);
      if (themeIds.has(tid)) errs.push(`Duplicate Theme_ID "${tid}".`);
      themeIds.add(tid);
      if (!str(t.Second_Order_Theme)) errs.push(`Second_Order_Theme is empty for ${tid}.`);
      for (const cid of splitIds(t.First_Order_Concept_IDs)) {
        if (!conceptIds.has(cid)) errs.push(`Theme ${tid} references unknown Concept_ID "${cid}".`);
        else grouped.add(cid);
      }
    }
    for (const cid of conceptIds) {
      if (!grouped.has(cid)) errs.push(`Concept ${cid} is not grouped into any theme.`);
    }
    return errs;
  }

  private validateStage4(j: Json, themes: SecondOrderTheme[]): string[] {
    const errs: string[] = [];
    const themeIds = new Set(themes.map((t) => t.Theme_ID));
    const dims = asArray(j.aggregate_dimensions);
    if (dims.length === 0) errs.push("aggregate_dimensions is empty.");
    const aggIds = new Set<string>();
    const grouped = new Set<string>();
    for (const d of dims) {
      const aid = str(d.Aggregate_ID);
      if (!/^AGG_\d+/.test(aid)) errs.push(`Aggregate_ID "${aid}" is malformed (expected AGG_1).`);
      if (aggIds.has(aid)) errs.push(`Duplicate Aggregate_ID "${aid}".`);
      aggIds.add(aid);
      if (!str(d.Aggregate_Dimension)) errs.push(`Aggregate_Dimension is empty for ${aid}.`);
      for (const tid of splitIds(d.Theme_IDs)) {
        if (!themeIds.has(tid)) errs.push(`Dimension ${aid} references unknown Theme_ID "${tid}".`);
        else grouped.add(tid);
      }
    }
    for (const tid of themeIds) {
      if (!grouped.has(tid)) errs.push(`Theme ${tid} is not grouped into any aggregate dimension.`);
    }
    return errs;
  }

  private validateStage5(j: Json, excerpts: RawExcerpt[]): string[] {
    const errs: string[] = [];
    const rawIds = new Set(excerpts.map((r) => r.Raw_ID));
    for (const f of asArray(j.analytical_flags)) {
      const id = str(f.Raw_ID);
      if (!rawIds.has(id)) errs.push(`analytical_flags references unknown Raw_ID "${id}".`);
      const flags = Array.isArray(f.Flags) ? f.Flags.map(String) : splitIds(f.Flags);
      for (const fl of flags) {
        if (!FLAG_OPTIONS.includes(fl.trim())) errs.push(`Unknown flag "${fl}" on ${id}.`);
      }
    }
    if (!str(j.refinement_summary)) errs.push("refinement_summary is empty.");
    const memo = j.research_question_memo as Json | undefined;
    if (!memo || !str(memo.RQ_Focus) || !str(memo.Analytical_Memo)) {
      errs.push("research_question_memo.RQ_Focus / Analytical_Memo is incomplete.");
    }
    return errs;
  }

  // ── Step 6: deterministic Gioia data structure (concept → theme → dimension) ─

  private buildDataStructure(
    concepts: FirstOrderConcept[],
    themes: SecondOrderTheme[],
    dimensions: AggregateDimension[],
  ): GioiaStructureRow[] {
    const themeByConcept = new Map<string, SecondOrderTheme>();
    for (const t of themes) {
      for (const cid of splitIds(t.First_Order_Concept_IDs)) {
        if (!themeByConcept.has(cid)) themeByConcept.set(cid, t);
      }
    }
    const dimByTheme = new Map<string, AggregateDimension>();
    for (const d of dimensions) {
      for (const tid of splitIds(d.Theme_IDs)) {
        if (!dimByTheme.has(tid)) dimByTheme.set(tid, d);
      }
    }
    const seen = new Set<string>();
    const rows: GioiaStructureRow[] = [];
    for (const c of concepts) {
      if (seen.has(c.Concept_ID)) continue; // one row per first-order concept (type)
      seen.add(c.Concept_ID);
      const t = themeByConcept.get(c.Concept_ID);
      const d = t ? dimByTheme.get(t.Theme_ID) : undefined;
      rows.push({
        Concept_ID: c.Concept_ID,
        First_Order_Concept: c.First_Order_Concept,
        Theme_ID: t?.Theme_ID ?? "",
        Second_Order_Theme: t?.Second_Order_Theme ?? "",
        Aggregate_ID: d?.Aggregate_ID ?? "",
        Aggregate_Dimension: d?.Aggregate_Dimension ?? "",
      });
    }
    return rows;
  }

  // ── Legacy single-call pipeline (PIPELINE_MODE=single, the fallback) ─────────

  private async analyseSingle(
    policyText: string,
    fileName: string,
    existing: ExistingContext,
  ): Promise<GioiaAnalysis> {
    // Single-call mode does every step at once, so it gets all levels.
    const fullContext = this.contextSection(existing, {
      concepts: true,
      themes: true,
      dimensions: true,
    });
    const systemPrompt = `${GIOIA_SYSTEM_PROMPT}\n\n${GIOIA_OUTPUT_CONTRACT}`;
    const userMessage = [
      `UPLOADED FILE NAME: ${fileName}`,
      `Derive the Document_ID from this file name where it already encodes one (e.g. "EU_01.pdf" -> "EU_01").`,
      "",
      "CURRENT MASTER CODEBOOK (for cross-document comparison / code reuse — Step 7):",
      fullContext,
      "",
      "POLICY DOCUMENT TEXT:",
      "<<<BEGIN POLICY TEXT>>>",
      policyText,
      "<<<END POLICY TEXT>>>",
    ].join("\n");

    const parsed = await this.callModel(systemPrompt, userMessage, "single-call", "reason");
    return parsed as unknown as GioiaAnalysis;
  }

  // ── Model call: route to the tier's provider, then tolerant JSON parse ──────

  private async callModel(system: string, user: string, label: string, tier: Tier): Promise<Json> {
    const { provider, model } = this.resolveModel(tier);
    const raw =
      provider === "anthropic"
        ? await this.callAnthropic(system, user, model, tier, label)
        : await this.callChutes(system, user, model, label);
    return this.parseJson(raw, label);
  }

  /** Claude via the Anthropic SDK — streaming, adaptive thinking on the reasoning tier. */
  private async callAnthropic(
    system: string,
    user: string,
    model: string,
    tier: Tier,
    label: string,
  ): Promise<string> {
    const client = this.getAnthropic();
    const params: Record<string, unknown> = {
      model,
      max_tokens: tier === "reason" ? 24000 : 12000,
      system,
      messages: [{ role: "user", content: user }],
    };
    // Adaptive thinking + effort on the reasoning tier only (skip on extract/
    // concepts, and on Haiku which supports neither). `MODEL_EFFORT` dials how
    // hard the model thinks: low | medium | high | max — lower is cheaper/faster.
    if (tier === "reason" && !/haiku/i.test(model)) {
      params.thinking = { type: "adaptive" };
      const effort = (this.config.get<string>("MODEL_EFFORT") ?? "medium").toLowerCase();
      params.output_config = { effort };
    }

    try {
      type StreamParams = Parameters<typeof client.messages.stream>[0];
      const stream = client.messages.stream(params as unknown as StreamParams);
      const message = await stream.finalMessage();
      if (message.stop_reason === "refusal") {
        throw new ServiceUnavailableException(`The analysis model declined the request (${label}).`);
      }
      let out = "";
      for (const block of message.content) if (block.type === "text") out += block.text;
      return out;
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      const detail = err instanceof Error ? err.message : "unknown error";
      this.logger.error(`${label} (Claude ${model}) request failed: ${detail}`);
      throw new ServiceUnavailableException(`Analysis model request failed: ${detail}`);
    }
  }

  /** Open models via Chutes (OpenAI-compatible) — streaming JSON mode with fallback. */
  private async callChutes(system: string, user: string, model: string, label: string): Promise<string> {
    const client = this.getClient();
    const base = {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ] as OpenAI.Chat.ChatCompletionMessageParam[],
      max_tokens: 32000,
      temperature: 0.2,
      stream: true as const,
    };
    try {
      return await this.stream(client, { ...base, response_format: { type: "json_object" } });
    } catch (err) {
      if (this.isBadRequest(err)) {
        this.logger.warn(`${label}: provider rejected response_format; retrying without JSON mode.`);
        return await this.stream(client, base);
      }
      const detail = err instanceof Error ? err.message : "unknown error";
      this.logger.error(`${label} (Chutes ${model}) request failed: ${detail}`);
      throw new ServiceUnavailableException(`Analysis model request failed: ${detail}`);
    }
  }

  private async stream(
    client: OpenAI,
    params: OpenAI.Chat.ChatCompletionCreateParamsStreaming,
  ): Promise<string> {
    const stream = await client.chat.completions.create(params);
    let content = "";
    for await (const chunk of stream) {
      content += chunk.choices[0]?.delta?.content ?? "";
    }
    return content;
  }

  private isBadRequest(err: unknown): boolean {
    return err instanceof OpenAI.APIError && err.status === 400;
  }

  /** Parse model output into an object, tolerating code fences / surrounding prose. */
  private parseJson(raw: string, label: string): Json {
    const text = raw.trim();
    if (!text) {
      throw new ServiceUnavailableException(`The analysis model returned an empty response (${label}).`);
    }
    const candidates = [text, this.stripFences(text), this.firstJsonObject(text)];
    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        const obj = JSON.parse(candidate) as unknown;
        if (obj && typeof obj === "object") return obj as Json;
      } catch {
        /* try next candidate */
      }
    }
    this.logger.error(`Could not parse ${label} JSON. First 300 chars: ${text.slice(0, 300)}`);
    throw new ServiceUnavailableException(`The analysis model returned malformed JSON (${label}).`);
  }

  private stripFences(text: string): string {
    return text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
  }

  private firstJsonObject(text: string): string | null {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    return start >= 0 && end > start ? text.slice(start, end + 1) : null;
  }
}

// ── small helpers ─────────────────────────────────────────────────────────────

/**
 * Parse a per-tier override into a provider + model. Accepts an explicit
 * `anthropic:`/`chutes:` prefix, otherwise infers Anthropic for `claude-*` ids
 * and Chutes for everything else. Examples: "claude-opus-4-8",
 * "chutes:Qwen/Qwen3-32B-TEE", "anthropic:claude-sonnet-4-6".
 */
function parseModelRef(value: string): ModelRef {
  if (value.startsWith("anthropic:")) return { provider: "anthropic", model: value.slice("anthropic:".length) };
  if (value.startsWith("chutes:")) return { provider: "chutes", model: value.slice("chutes:".length) };
  if (/^claude/i.test(value)) return { provider: "anthropic", model: value };
  return { provider: "chutes", model: value };
}

/** Render an "ID: label" code list under a header, or a "(none yet)" placeholder. */
function codesSection(header: string, items: string[]): string {
  return `${header}\n${items.length ? items.join("\n") : "(none yet)"}`;
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function asArray(v: unknown): Json[] {
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Json[]) : [];
}

function splitIds(v: unknown): string[] {
  return str(v)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

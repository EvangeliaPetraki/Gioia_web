/**
 * Per-model token prices in USD per 1,000,000 tokens, used to cost each LLM
 * call for the admin usage report.
 *
 * Anthropic figures are current list prices. **The Chutes open-model figures are
 * ESTIMATES** — adjust them to your actual Chutes billing. A model missing from
 * this table is costed as $0 (and surfaced in the report's `unpricedModels`).
 */
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  // Anthropic (list prices, USD / 1M tokens)
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  // Chutes open models — ESTIMATES, tune to your billing (USD / 1M tokens)
  "deepseek-ai/DeepSeek-V3.2-TEE": { input: 0.28, output: 0.42 },
  "Qwen/Qwen3-32B-TEE": { input: 0.1, output: 0.3 },
  "zai-org/GLM-5.2-TEE": { input: 0.3, output: 0.9 },
  "zai-org/GLM-5-TEE": { input: 0.3, output: 0.9 },
};

/** Cost of one call in USD; 0 for models without a listed price. */
export function computeCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = MODEL_PRICES[model];
  if (!p) return 0;
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}

/** One LLM call's token usage, produced by GioiaService and costed by UsageService. */
export interface StageUsage {
  provider: string;
  model: string;
  stage: string;
  inputTokens: number;
  outputTokens: number;
}

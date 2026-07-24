// USD per million tokens. These are NOT decorative — three budget gates
// (anthropic-direct, openai-direct, OpenRouter) and the converse cap all read
// cost derived from this table, so a wrong entry closes a lane early or lets
// one overrun. Rates verified against list pricing 2026-07-24.
import type { Metric } from '@/lib/types/database.types';

export const PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  // Anthropic-direct lanes.
  'claude-fable-5':   { input: 10, output: 50 },
  'claude-opus-5':    { input: 5,  output: 25 },
  'claude-opus-4-8':  { input: 5,  output: 25 },
  // Sonnet 5 carries a $2/$10 intro rate through 2026-08-31; the standard
  // $3/$15 is used deliberately so the gate trips early, never late.
  'claude-sonnet-5':  { input: 3,  output: 15 },
  'claude-haiku-4-5': { input: 1,  output: 5 },
  // OpenAI-direct lane. The ledger is keyed by the API-returned model id,
  // which has NO vendor prefix — both spellings must resolve or the row falls
  // through to DEFAULT_PRICE and the gate over-counts ~2x.
  'gpt-5.3-codex':        { input: 1.75, output: 14 },
  'openai/gpt-5.3-codex': { input: 1.75, output: 14 },
  // OpenRouter slugs (as written to `metrics.model` by the dispatcher).
  'openai/gpt-4o-mini': { input: 0.15, output: 0.6 },
  'openai/gpt-5.4':     { input: 1.25, output: 10 },
  'anthropic/claude-sonnet-4.6': { input: 3, output: 15 },
  'anthropic/claude-haiku-4.5':  { input: 1, output: 5 },
  'meta-llama/llama-3.3-70b-instruct': { input: 0.12, output: 0.3 },
  'meta-llama/llama-3.1-70b-instruct': { input: 0.12, output: 0.3 },
  'meta-llama/llama-3.1-8b-instruct':  { input: 0.02, output: 0.03 },
  'google/gemini-2.5-pro': { input: 1.25, output: 10 },
  'x-ai/grok-4.3':         { input: 3, output: 15 },
  'nousresearch/hermes-4-405b': { input: 0.9, output: 0.9 },
  // Free lanes — real cost is zero. Pricing them at DEFAULT_PRICE charged the
  // NVIDIA free tier ~$0.014 against the $1 OpenRouter cap for work that cost
  // nothing.
  'nvidia/llama-3.3-nemotron-super-49b-v1.5': { input: 0, output: 0 },
  // Pseudo-models the ledger uses as event markers, not billable calls.
  'direct-tool-fast-path': { input: 0, output: 0 },
  'converse-budget-gate':  { input: 0, output: 0 },
};
const DEFAULT_PRICE = { input: 3, output: 15 };

// Anthropic prompt-cache multipliers, applied to the model's INPUT rate.
// Writes carry a premium; reads are the whole point of caching.
export const CACHE_WRITE_MULTIPLIER = 1.25;
export const CACHE_READ_MULTIPLIER = 0.1;

export const MODEL_SHORT: Record<string, string> = {
  'claude-fable-5':   'Fable',
  'claude-opus-4-8':  'Opus',
  'claude-haiku-4-5': 'Haiku',
};

export function shortModel(model: string | null | undefined): string {
  if (!model) return '—';
  return MODEL_SHORT[model] ?? model.replace(/^claude-/, '');
}

/**
 * `inputTokens` is the UNCACHED remainder only — Anthropic reports cache
 * traffic in separate counters, so a cache-heavy call whose ledger row records
 * input alone under-states real spend by whatever the cache absorbed. Callers
 * that have the cache counters must pass them; callers that don't are
 * unchanged (both default to 0).
 */
export function estimateModelCostUsd(
  model: string,
  inputTokens = 0,
  outputTokens = 0,
  cacheWriteTokens = 0,
  cacheReadTokens = 0,
): number {
  const price = PRICING_PER_MTOK[model] ?? DEFAULT_PRICE;
  const cached =
    cacheWriteTokens * price.input * CACHE_WRITE_MULTIPLIER +
    cacheReadTokens * price.input * CACHE_READ_MULTIPLIER;
  return (inputTokens * price.input + outputTokens * price.output + cached) / 1e6;
}

export function estimateMetricCostUsd(
  metric: Pick<Metric, 'model' | 'input_tokens' | 'output_tokens'> &
    Partial<Pick<Metric, 'cache_write_tokens' | 'cache_read_tokens'>>,
): number {
  return estimateModelCostUsd(
    metric.model,
    metric.input_tokens ?? 0,
    metric.output_tokens ?? 0,
    metric.cache_write_tokens ?? 0,
    metric.cache_read_tokens ?? 0,
  );
}

export interface SpendSummary {
  totalTokens: number;
  totalCostUsd: number;
  fableShare: number; // 0–1
  byModel: Record<string, { tokens: number; costUsd: number }>;
}

export function summarizeSpend(metrics: Metric[]): SpendSummary {
  const byModel: SpendSummary['byModel'] = {};
  let totalTokens = 0;
  let totalCostUsd = 0;
  for (const m of metrics) {
    // Cache traffic counts as tokens processed — excluding it made a
    // cache-heavy lane look artificially cheap in the share calculation.
    const tokens =
      (m.input_tokens ?? 0) + (m.output_tokens ?? 0) + (m.cache_write_tokens ?? 0) + (m.cache_read_tokens ?? 0);
    const cost = estimateMetricCostUsd(m);
    const entry = (byModel[m.model] ??= { tokens: 0, costUsd: 0 });
    entry.tokens += tokens;
    entry.costUsd += cost;
    totalTokens += tokens;
    totalCostUsd += cost;
  }
  const fable = byModel['claude-fable-5']?.tokens ?? 0;
  return {
    totalTokens,
    totalCostUsd,
    fableShare: totalTokens > 0 ? fable / totalTokens : 0,
    byModel,
  };
}

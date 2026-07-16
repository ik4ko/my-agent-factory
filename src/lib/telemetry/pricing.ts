// USD per million tokens — ESTIMATES for the dashboard cost readout only.
// Adjust freely; nothing routes on these numbers.
import type { Metric } from '@/lib/types/database.types';

export const PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-fable-5':   { input: 30, output: 150 },
  'claude-opus-4-8':  { input: 15, output: 75 },
  'claude-sonnet-5':  { input: 3,  output: 15 },
  'claude-haiku-4-5': { input: 1,  output: 5 },
  'openai/gpt-4o-mini': { input: 0.15, output: 0.6 },
  'openai/gpt-5.3-codex': { input: 3, output: 15 },
};
const DEFAULT_PRICE = { input: 3, output: 15 };

export const MODEL_SHORT: Record<string, string> = {
  'claude-fable-5':   'Fable',
  'claude-opus-4-8':  'Opus',
  'claude-haiku-4-5': 'Haiku',
};

export function shortModel(model: string | null | undefined): string {
  if (!model) return '—';
  return MODEL_SHORT[model] ?? model.replace(/^claude-/, '');
}

export function estimateModelCostUsd(model: string, inputTokens = 0, outputTokens = 0): number {
  const price = PRICING_PER_MTOK[model] ?? DEFAULT_PRICE;
  return (inputTokens * price.input + outputTokens * price.output) / 1e6;
}

export function estimateMetricCostUsd(metric: Pick<Metric, 'model' | 'input_tokens' | 'output_tokens'>): number {
  return estimateModelCostUsd(metric.model, metric.input_tokens ?? 0, metric.output_tokens ?? 0);
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
    const tokens = (m.input_tokens ?? 0) + (m.output_tokens ?? 0);
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

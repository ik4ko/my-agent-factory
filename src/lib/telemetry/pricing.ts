// USD per million tokens — ESTIMATES for the dashboard cost readout only.
// Adjust freely; nothing routes on these numbers.
import type { Metric } from '@/lib/types/database.types';

export const PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-fable-5':   { input: 30, output: 150 },
  'claude-opus-4-8':  { input: 15, output: 75 },
  'claude-haiku-4-5': { input: 1,  output: 5 },
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
    const price = PRICING_PER_MTOK[m.model] ?? DEFAULT_PRICE;
    const tokens = (m.input_tokens ?? 0) + (m.output_tokens ?? 0);
    const cost = ((m.input_tokens ?? 0) * price.input + (m.output_tokens ?? 0) * price.output) / 1e6;
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

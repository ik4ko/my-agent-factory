import { summarizeSpend, shortModel } from '@/lib/telemetry/pricing';
import type { Metric } from '@/lib/types/database.types';

const m = (model: string, input: number, output: number): Metric => ({
  id: 'x', task_id: null, agent_id: null, model,
  event: 'USAGE', input_tokens: input, output_tokens: output,
  detail: null, created_at: '2026-07-03T00:00:00Z',
});

describe('summarizeSpend', () => {
  it('aggregates tokens, cost, and fable share', () => {
    const s = summarizeSpend([
      m('claude-fable-5', 100_000, 10_000),   // 30*0.1 + 150*0.01 = 4.5 USD, 110k tok
      m('claude-haiku-4-5', 800_000, 90_000), // 1*0.8 + 5*0.09 = 1.25 USD, 890k tok
    ]);
    expect(s.totalTokens).toBe(1_000_000);
    expect(s.totalCostUsd).toBeCloseTo(5.75, 5);
    expect(s.fableShare).toBeCloseTo(0.11, 5);
  });

  it('handles empty input without dividing by zero', () => {
    expect(summarizeSpend([])).toMatchObject({ totalTokens: 0, totalCostUsd: 0, fableShare: 0 });
  });

  it('prices unknown models with the default rate', () => {
    const s = summarizeSpend([m('claude-mystery-9', 1_000_000, 0)]);
    expect(s.totalCostUsd).toBeCloseTo(3, 5);
  });
});

describe('shortModel', () => {
  it('maps known lanes and strips the claude- prefix otherwise', () => {
    expect(shortModel('claude-fable-5')).toBe('Fable');
    expect(shortModel('claude-opus-4-8')).toBe('Opus');
    expect(shortModel('claude-haiku-4-5')).toBe('Haiku');
    expect(shortModel('claude-sonnet-5')).toBe('sonnet-5');
    expect(shortModel(null)).toBe('—');
  });
});

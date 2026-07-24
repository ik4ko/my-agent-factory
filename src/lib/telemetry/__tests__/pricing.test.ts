import { summarizeSpend, shortModel, estimateModelCostUsd, isStrictlyCheaper } from '@/lib/telemetry/pricing';
import type { Metric } from '@/lib/types/database.types';

const m = (model: string, input: number, output: number): Metric => ({
  id: 'x', task_id: null, agent_id: null, model,
  event: 'USAGE', input_tokens: input, output_tokens: output,
  detail: null, created_at: '2026-07-03T00:00:00Z',
});

describe('summarizeSpend', () => {
  it('aggregates tokens, cost, and fable share', () => {
    const s = summarizeSpend([
      m('claude-fable-5', 100_000, 10_000),   // 10*0.1 + 50*0.01 = 1.5 USD, 110k tok
      m('claude-haiku-4-5', 800_000, 90_000), // 1*0.8 + 5*0.09 = 1.25 USD, 890k tok
    ]);
    expect(s.totalTokens).toBe(1_000_000);
    expect(s.totalCostUsd).toBeCloseTo(2.75, 5);
    expect(s.fableShare).toBeCloseTo(0.11, 5);
  });

  it('handles empty input without dividing by zero', () => {
    expect(summarizeSpend([])).toMatchObject({ totalTokens: 0, totalCostUsd: 0, fableShare: 0 });
  });

  it('prices unknown models with the default rate', () => {
    const s = summarizeSpend([m('claude-mystery-9', 1_000_000, 0)]);
    expect(s.totalCostUsd).toBeCloseTo(3, 5);
  });

  it('prices the openai-direct lane by its API-returned id (no vendor prefix)', () => {
    // The ledger writes `gpt-5.3-codex`; only `openai/gpt-5.3-codex` used to be
    // in the table, so these rows silently fell through to DEFAULT_PRICE.
    const s = summarizeSpend([m('gpt-5.3-codex', 1_000_000, 0)]);
    expect(s.totalCostUsd).toBeCloseTo(1.75, 5);
  });

  it('prices free lanes at zero rather than the default rate', () => {
    const s = summarizeSpend([m('nvidia/llama-3.3-nemotron-super-49b-v1.5', 1_000_000, 1_000_000)]);
    expect(s.totalCostUsd).toBe(0);
  });
});

describe('cache-aware pricing', () => {
  it('bills cache writes at 1.25x and reads at 0.1x the input rate', () => {
    // Haiku input is $1/Mtok: 1M write = $1.25, 1M read = $0.10.
    expect(estimateModelCostUsd('claude-haiku-4-5', 0, 0, 1_000_000, 0)).toBeCloseTo(1.25, 5);
    expect(estimateModelCostUsd('claude-haiku-4-5', 0, 0, 0, 1_000_000)).toBeCloseTo(0.1, 5);
  });

  it('counts cache traffic as tokens processed in the share denominator', () => {
    const s = summarizeSpend([
      { ...m('claude-sonnet-5', 100, 100), cache_write_tokens: 500, cache_read_tokens: 300 },
    ]);
    expect(s.totalTokens).toBe(1000);
  });

  it('defaults cache counters to zero for lanes that do not report them', () => {
    expect(estimateModelCostUsd('claude-haiku-4-5', 1_000_000, 0)).toBeCloseTo(1, 5);
  });
});

describe('isStrictlyCheaper (converse routing canary cost ceiling)', () => {
  const CEO_DEFAULT = 'claude-sonnet-5';

  it('lets a SEAT-to-Haiku decision through', () => {
    expect(isStrictlyCheaper('claude-haiku-4-5', CEO_DEFAULT)).toBe(true);
  });

  it('VETOES the UP path, which lands on Opus and costs MORE than the default', () => {
    // routeModel escalates high-stakes work to Fable, then DOWNs to Opus for
    // payloads under 2k tokens — every chat message. Opus 4.8 is $5/$25 vs
    // Sonnet 5 at $3/$15, so the canary must refuse it.
    expect(isStrictlyCheaper('claude-opus-4-8', CEO_DEFAULT)).toBe(false);
    expect(isStrictlyCheaper('claude-fable-5', CEO_DEFAULT)).toBe(false);
  });

  it('rejects an equal-priced model (no churn for no saving)', () => {
    expect(isStrictlyCheaper(CEO_DEFAULT, CEO_DEFAULT)).toBe(false);
  });

  it('treats an unpriced model as the default rate, so it cannot sneak past', () => {
    expect(isStrictlyCheaper('some-unknown-model', CEO_DEFAULT)).toBe(false);
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

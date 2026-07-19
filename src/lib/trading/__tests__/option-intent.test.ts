/**
 * Deterministic proof harness for the option-intent staging lane.
 *
 * Exercises the real pure functions (no DB, no network) across positive and
 * negative fixtures: parser → validator → build step → persistence-shape.
 * The DB-constraint mirror keeps the app validator and the SQL CHECK
 * constraint (staged_orders_option_intent_required) from silently diverging.
 */
jest.mock('@/lib/supabase/admin', () => ({ getAdminClient: jest.fn() }));
jest.mock('@/lib/hermes/hermes-logger', () => ({ hermesLog: jest.fn() }));

import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { extractOptionOrderIntent, validateDefinedRisk } from '@/lib/trading/option-intent';
import { buildStagedOptionOrder, buildStagedOrder, extractTradeParams, persistStagedOrder, stageOrderFromAnalysis } from '@/lib/trading/stage';
import type { PipelineContext } from '@/lib/pipeline/types';
import { OptionOrderIntentSchema } from '@/lib/types/trading.types';

const SIGNAL = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  jest.clearAllMocks();
});

function mockStageDb() {
  const insert = jest.fn(async () => ({ error: null }));
  const from = jest.fn(() => ({ insert }));
  (getAdminClient as jest.Mock).mockReturnValue({ from });
  return { from, insert };
}

function optionText(overrides: Record<string, unknown> = {}): string {
  const base = {
    underlying: 'NVDA',
    option_type: 'CALL',
    action: 'buy_to_open',
    strike: 195,
    expiration: '2026-08-21',
    limit_price: 4.25, // 2 * 4.25 * 100 = 850 premium
    contracts: 2,
    price_effect: 'debit',
    max_premium_usd: 900,
    max_loss_usd: 850,
    strategy_label: 'flow-follow long call',
    source: 'RESEARCH', // must be force-downgraded to SANDBOX
    source_signal_id: SIGNAL,
  };
  return `pre-analysis text\nOPTION_INTENT: ${JSON.stringify({ ...base, ...overrides })}\ntrailing`;
}

/** Columns that actually exist on public.staged_orders (legacy + option-intent
 *  migration). A row builder must never emit a key outside this set, or the
 *  insert would fail at runtime. */
const ALLOWED_STAGED_ORDER_COLUMNS = new Set([
  'id', 'underlying', 'option_type', 'strike', 'expiration', 'execution_type',
  'limit_price', 'calculated_position_size_usd', 'human_approval_status', 'pipeline_id',
  'kelly_fraction', 'expectancy', 'win_rate', 'r_multiple', 'source', 'created_at',
  'intent_kind', 'action', 'contracts', 'price_effect', 'max_premium_usd',
  'max_loss_usd', 'strategy_label', 'source_signal_id',
]);

/** Mirror of the SQL CHECK constraint staged_orders_option_intent_required.
 *  Any row the app builds for an option_intent MUST satisfy this, or the DB
 *  rejects it. Encoding it here proves app + DB agree. */
function satisfiesDbOptionConstraint(row: Record<string, unknown>): boolean {
  if (row.intent_kind !== 'option_intent') return true;
  const premium = Number(row.contracts) * Number(row.limit_price) * 100;
  return (
    row.action != null &&
    row.action !== 'sell_to_open' &&
    row.contracts != null &&
    row.price_effect != null &&
    row.max_premium_usd != null &&
    row.max_loss_usd != null &&
    row.strategy_label != null &&
    row.source_signal_id != null &&
    row.source === 'SANDBOX' &&
    Number(row.max_loss_usd) <= Number(row.max_premium_usd) &&
    (row.price_effect !== 'debit' || premium <= Number(row.max_premium_usd))
  );
}

describe('pure parser + validator', () => {
  test('valid intent stages, forces SANDBOX, is never live-executable', () => {
    const res = extractOptionOrderIntent(optionText(), { fromOptionsFlow: true });
    expect(res.intent).not.toBeNull();
    expect(res.liveExecutable).toBe(false);
    expect(res.intent!.source).toBe('SANDBOX'); // forced even though input said RESEARCH
    expect(res.intent!.strategy_label).toBe('flow-follow long call');
    expect(res.intent!.source_signal_id).toBe(SIGNAL);
  });

  test('sell_to_open (naked short) is rejected', () => {
    const res = extractOptionOrderIntent(optionText({ action: 'sell_to_open', price_effect: 'credit' }), { fromOptionsFlow: true });
    expect(res.intent).toBeNull();
    expect(res.reason).toMatch(/short-open|undefined risk/i);
  });

  test('undefined risk (max_loss > max_premium) is rejected', () => {
    const res = extractOptionOrderIntent(optionText({ max_loss_usd: 5000 }), { fromOptionsFlow: true });
    expect(res.intent).toBeNull();
    expect(res.reason).toMatch(/risk not defined|exceeds max_premium/i);
  });

  test('premium outlay over the cap is rejected', () => {
    // 5 * 4.25 * 100 = 2125 > 900 cap
    const res = extractOptionOrderIntent(optionText({ contracts: 5 }), { fromOptionsFlow: true });
    expect(res.intent).toBeNull();
    expect(res.reason).toMatch(/exceeds max_premium/i);
  });

  test('missing source_signal_id is rejected when options-flow-derived', () => {
    const res = extractOptionOrderIntent(optionText({ source_signal_id: undefined }), { fromOptionsFlow: true });
    expect(res.intent).toBeNull();
    expect(res.reason).toMatch(/source_signal_id/i);
  });

  test('malformed JSON and missing block fail cleanly (never throw)', () => {
    expect(extractOptionOrderIntent('OPTION_INTENT: {not json}', { fromOptionsFlow: true }).intent).toBeNull();
    expect(extractOptionOrderIntent('no block here', { fromOptionsFlow: true }).reason).toMatch(/no OPTION_INTENT block/i);
  });

  test('unknown keys are rejected by the strict schema', () => {
    const res = extractOptionOrderIntent(optionText({ execution_type: 'MARKET' }), { fromOptionsFlow: true });
    expect(res.intent).toBeNull();
    expect(res.reason).toMatch(/failed schema/i);
  });

  test('validateDefinedRisk unit: accepts a defined-risk long debit', () => {
    const intent = OptionOrderIntentSchema.parse(JSON.parse(optionText().match(/OPTION_INTENT:\s*(\{.*\})/)![1]));
    expect(validateDefinedRisk(intent, true)).toBeNull();
  });
});

describe('staging / build step', () => {
  test('build produces a SANDBOX, PENDING option row preserving audit fields', () => {
    const parsed = extractOptionOrderIntent(optionText(), { fromOptionsFlow: true });
    const row = buildStagedOptionOrder(parsed.intent!, { pipelineId: 'pipe-1' });
    expect(row.intent_kind).toBe('option_intent');
    expect(row.human_approval_status).toBe('PENDING');
    expect(row.source).toBe('SANDBOX');
    expect(row.execution_type).toBe('LIMIT');
    expect(row.action).toBe('buy_to_open');
    expect(row.contracts).toBe(2);
    expect(row.strategy_label).toBe('flow-follow long call');
    expect(row.source_signal_id).toBe(SIGNAL);
    // legacy Kelly telemetry is null for option intents
    expect(row.kelly_fraction).toBeNull();
    expect(row.expectancy).toBeNull();
    expect(row.win_rate).toBeNull();
    expect(row.r_multiple).toBeNull();
  });

  test('option row shape stays within real staged_orders columns', () => {
    const parsed = extractOptionOrderIntent(optionText(), { fromOptionsFlow: true });
    const row = buildStagedOptionOrder(parsed.intent!, { pipelineId: null });
    for (const key of Object.keys(row)) {
      expect(ALLOWED_STAGED_ORDER_COLUMNS.has(key)).toBe(true);
    }
  });

  test('built option row satisfies the DB CHECK constraint mirror', () => {
    const parsed = extractOptionOrderIntent(optionText(), { fromOptionsFlow: true });
    const row = buildStagedOptionOrder(parsed.intent!, { pipelineId: null });
    expect(satisfiesDbOptionConstraint(row as unknown as Record<string, unknown>)).toBe(true);
  });
});

describe('real stage call site', () => {
  const context: PipelineContext = {
    id: '22222222-2222-4222-8222-222222222222',
    playbook: 'market-strategy',
    step: 2,
    role: 'EXECUTION',
    objective: 'Evaluate NVDA for a defined-risk options entry',
    simulate: true,
    trigger: 'manual',
  };

  test('stages a valid option intent through stageOrderFromAnalysis with audit fields intact', async () => {
    const { from, insert } = mockStageDb();

    const result = await stageOrderFromAnalysis(context, optionText(), 'agent-1');

    expect(result.staged).not.toBeNull();
    const staged = result.staged as ReturnType<typeof buildStagedOptionOrder>;
    expect(staged.intent_kind).toBe('option_intent');
    expect(staged.source).toBe('SANDBOX');
    expect(staged.strategy_label).toBe('flow-follow long call');
    expect(staged.source_signal_id).toBe(SIGNAL);
    expect(from).toHaveBeenCalledWith('staged_orders');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        intent_kind: 'option_intent',
        source: 'SANDBOX',
        strategy_label: 'flow-follow long call',
        source_signal_id: SIGNAL,
        pipeline_id: context.id,
      }),
    );
    expect(hermesLog).toHaveBeenCalledWith(
      'success',
      expect.stringContaining('Option intent staged for NVDA'),
      'agent-1',
    );
  });

  test('rejects a missing source_signal_id before any DB insert', async () => {
    const { from, insert } = mockStageDb();

    const result = await stageOrderFromAnalysis(context, optionText({ source_signal_id: undefined }), 'agent-1');

    expect(result.staged).toBeNull();
    expect(result.reason).toMatch(/source_signal_id/i);
    expect(from).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(hermesLog).toHaveBeenCalledWith('warn', expect.stringContaining('source_signal_id'), 'agent-1');
  });

  test('refuses to persist an option row that drifts from the SANDBOX contract before DB insert', async () => {
    const { from, insert } = mockStageDb();
    const parsed = extractOptionOrderIntent(optionText(), { fromOptionsFlow: true });
    const row = buildStagedOptionOrder(parsed.intent!, { pipelineId: context.id });

    await expect(persistStagedOrder({ ...row, source: 'RESEARCH' } as unknown as typeof row)).rejects.toThrow(/SANDBOX/);
    expect(from).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
});

describe('legacy staged-order behavior preserved', () => {
  const TRADE_PARAMS = 'TRADE_PARAMS: {"underlying":"AAPL","option_type":"CALL","strike":230,"expiration":"2026-08-21","max_entry_debit":3.5,"win_rate":0.6,"r_multiple":2}';

  test('positive-edge legacy params still build a sized PENDING legacy row', () => {
    const params = extractTradeParams(TRADE_PARAMS);
    expect(params).not.toBeNull();
    const result = buildStagedOrder(params!, { pipelineId: 'p', source: 'SANDBOX', equityUsd: 10_000 });
    expect(result.staged).not.toBeNull();
    const row = result.staged as unknown as Record<string, unknown>;
    expect(row.human_approval_status).toBe('PENDING');
    expect(row.source).toBe('SANDBOX');
    expect(row.kelly_fraction).toBeGreaterThan(0); // legacy Kelly sizing intact
    expect(row.intent_kind).toBeUndefined(); // legacy rows carry no option intent_kind
    for (const key of Object.keys(row)) {
      expect(ALLOWED_STAGED_ORDER_COLUMNS.has(key)).toBe(true);
    }
  });

  test('negative-edge legacy params stage nothing (constraint 1)', () => {
    const params = extractTradeParams(
      'TRADE_PARAMS: {"underlying":"AAPL","option_type":"CALL","strike":230,"expiration":"2026-08-21","max_entry_debit":3.5,"win_rate":0.3,"r_multiple":1}',
    );
    const result = buildStagedOrder(params!, { pipelineId: 'p', source: 'SANDBOX', equityUsd: 10_000 });
    expect(result.staged).toBeNull();
    expect(result.reason).toMatch(/expectancy|kelly/i);
  });
});

// ---- Expanded regression matrix: pin the persistence contract exhaustively ----

function parseIntent(overrides: Record<string, unknown> = {}) {
  return extractOptionOrderIntent(optionText(overrides), { fromOptionsFlow: true });
}

/** A valid built option row, then shallow-overridden. Lets us pin the DB
 *  persistence contract directly, independent of the parser path. */
function builtOptionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const parsed = parseIntent();
  const row = buildStagedOptionOrder(parsed.intent!, { pipelineId: null }) as unknown as Record<string, unknown>;
  return { ...row, ...overrides };
}

describe('boundary conditions', () => {
  test('premium exactly at the cap is accepted (<=)', () => {
    // 2 * 4.5 * 100 = 900 == max_premium 900
    expect(parseIntent({ limit_price: 4.5, max_premium_usd: 900, max_loss_usd: 900 }).intent).not.toBeNull();
  });

  test('max_loss exactly equal to max_premium is accepted (<=)', () => {
    expect(parseIntent({ max_loss_usd: 900, max_premium_usd: 900 }).intent).not.toBeNull();
  });

  test('max_loss one dollar over max_premium is rejected', () => {
    const res = parseIntent({ max_loss_usd: 901, max_premium_usd: 900 });
    expect(res.intent).toBeNull();
    expect(res.reason).toMatch(/risk not defined|exceeds max_premium/i);
  });

  test('premium one dollar over the cap is rejected', () => {
    // 2 * 4.51 * 100 = 902 > 900
    const res = parseIntent({ limit_price: 4.51, max_premium_usd: 900, max_loss_usd: 900 });
    expect(res.intent).toBeNull();
    expect(res.reason).toMatch(/exceeds max_premium/i);
  });
});

describe('action matrix (only sell_to_open is naked/undefined-risk)', () => {
  test('buy_to_open is accepted', () => {
    expect(parseIntent({ action: 'buy_to_open', price_effect: 'debit' }).intent).not.toBeNull();
  });
  test('sell_to_close is accepted (closing a long)', () => {
    expect(parseIntent({ action: 'sell_to_close', price_effect: 'credit' }).intent).not.toBeNull();
  });
  test('buy_to_close is accepted (closing a short)', () => {
    expect(parseIntent({ action: 'buy_to_close', price_effect: 'debit' }).intent).not.toBeNull();
  });
  test('sell_to_open is rejected (naked short)', () => {
    const res = parseIntent({ action: 'sell_to_open', price_effect: 'credit' });
    expect(res.intent).toBeNull();
    expect(res.reason).toMatch(/short-open|undefined risk/i);
  });
});

describe('schema field validation (strict contract)', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['lowercase underlying', { underlying: 'nvda' }],
    ['over-long underlying', { underlying: 'ABCDEFG' }],
    ['non-date expiration', { expiration: '2026/08/21' }],
    ['impossible calendar date', { expiration: '2026-13-45' }],
    ['non-uuid source_signal_id', { source_signal_id: 'evt_not_a_uuid' }],
    ['blank strategy_label', { strategy_label: '   ' }],
    ['over-long strategy_label', { strategy_label: 'x'.repeat(121) }],
    ['zero strike', { strike: 0 }],
    ['negative limit_price', { limit_price: -1 }],
    ['fractional contracts', { contracts: 2.5 }],
    ['zero contracts', { contracts: 0 }],
    ['unknown extra key', { execution_type: 'MARKET' }],
  ];
  test.each(cases)('rejects %s', (_label, override) => {
    const res = parseIntent(override);
    expect(res.intent).toBeNull();
    expect(res.reason).toMatch(/failed schema/i);
  });
});

describe('persistence contract: DB constraint mirror (staged_orders_option_intent_required)', () => {
  test('a valid built option row satisfies the constraint', () => {
    expect(satisfiesDbOptionConstraint(builtOptionRow())).toBe(true);
  });

  const violations: Array<[string, Record<string, unknown>]> = [
    ['null source_signal_id', { source_signal_id: null }],
    ['non-SANDBOX source', { source: 'RESEARCH' }],
    ['sell_to_open action', { action: 'sell_to_open' }],
    ['null action', { action: null }],
    ['null contracts', { contracts: null }],
    ['null price_effect', { price_effect: null }],
    ['null strategy_label', { strategy_label: null }],
    ['max_loss over max_premium', { max_loss_usd: 100_000 }],
  ];
  test.each(violations)('rejects an option row with %s', (_label, override) => {
    expect(satisfiesDbOptionConstraint(builtOptionRow(override))).toBe(false);
  });

  test('debit premium over the cap violates the constraint', () => {
    // base premium = 2 * 4.25 * 100 = 850; force the cap below it
    expect(satisfiesDbOptionConstraint(builtOptionRow({ max_premium_usd: 100, max_loss_usd: 100 }))).toBe(false);
  });

  test('legacy rows are exempt from option-intent requirements', () => {
    expect(satisfiesDbOptionConstraint({ intent_kind: 'legacy' })).toBe(true);
    expect(satisfiesDbOptionConstraint({})).toBe(true); // undefined intent_kind == legacy
  });
});

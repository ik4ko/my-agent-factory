import { z } from 'zod';

/**
 * Trading order staging domain — Phase 5.
 *
 * INVARIANTS (enforced in code, not prompts — the LLM has no path to relax them):
 *  1. Expectancy E = (Win% * Win$) - (Loss% * Loss$) must be > 0 to stage.
 *  2. Position size = min(half-Kelly, HARD_CAP_FRACTION) of paper equity.
 *     HARD_CAP_FRACTION is a frozen constant; every sizing path routes
 *     through `clampPositionFraction`.
 *  3. Nothing in this codebase executes orders. Staged rows are immutable
 *     proposals with human_approval_status='PENDING'; no brokerage SDKs.
 */

/** Hard ceiling on equity fraction per trade. Frozen — never read from LLM output. */
export const HARD_CAP_FRACTION = 0.02 as const;

/** Paper equity base for sizing math (env-overridable server-side). */
export const DEFAULT_PAPER_EQUITY_USD = 100_000;

export type OptionType = 'CALL' | 'PUT';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'DENIED';
export type OrderSource = 'SANDBOX' | 'RESEARCH';

/** A staged paper-analysis proposal awaiting human review. */
export interface StagedOrder {
  /** UUID. */
  id: string;
  underlying: string;
  option_type: OptionType;
  strike: number;
  /** YYYY-MM-DD. */
  expiration: string;
  execution_type: 'LIMIT';
  limit_price: number;
  calculated_position_size_usd: number;
  human_approval_status: ApprovalStatus;
  // ---- provenance & audit (beyond minimum spec, all real data) ----
  /** Pipeline run that produced this proposal (null for manual staging). */
  pipeline_id: string | null;
  /** Kelly fraction actually applied AFTER the conservative halving and 2% cap. */
  kelly_fraction: number;
  /** Expectancy in R units: E = W*R − (1−W). Staging requires E > 0. */
  expectancy: number;
  win_rate: number;
  r_multiple: number;
  source: OrderSource;
  created_at: string;
}

/**
 * The machine-readable block Codex must emit inside its ANALYSIS output:
 *   TRADE_PARAMS: {"underlying":"SPY","option_type":"CALL","strike":450,
 *     "expiration":"2026-08-21","max_entry_debit":1.25,"win_rate":0.55,"r_multiple":2.1}
 */
export const TradeParamsSchema = z.object({
  underlying: z
    .string()
    .trim()
    .regex(/^[A-Z]{1,6}$/, 'underlying must be a 1-6 letter uppercase ticker'),
  option_type: z.enum(['CALL', 'PUT']),
  strike: z.number().positive().finite(),
  expiration: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'expiration must be YYYY-MM-DD')
    .refine((s) => !Number.isNaN(Date.parse(s)), 'expiration must be a valid date'),
  /** Maximum entry debit per contract — becomes the LIMIT price. */
  max_entry_debit: z.number().positive().finite(),
  /** Assumed win rate (0,1) exclusive — assumptions, labeled as such upstream. */
  win_rate: z.number().gt(0).lt(1),
  /** Risk-to-reward multiple, > 0. */
  r_multiple: z.number().positive().finite(),
});
export type TradeParams = z.infer<typeof TradeParamsSchema>;

/** Input accepted by POST /api/trading/stage-order. The server assigns id and
 *  PENDING status and RECOMPUTES sizing — client-provided sizes are ignored. */
export const StageOrderInputSchema = TradeParamsSchema.extend({
  pipeline_id: z.string().uuid().nullable().optional(),
  source: z.enum(['SANDBOX', 'RESEARCH']).optional(),
});
export type StageOrderInput = z.infer<typeof StageOrderInputSchema>;

/**
 * OptionOrderIntent — REPRESENTATION ONLY. Nothing parses, stages, or executes
 * it yet; it is the canonical validated shape for a single-leg, defined-risk
 * option order so future work has a safe target.
 *
 * OPTION EXECUTION IS SIMULATION-ONLY by construction:
 *  1. The sole adapter accepts equity-shaped paper intents only.
 *  2. The risk gate has no per-contract / defined-risk
 *     / max-loss path exists.
 *  3. Dispatch is decision-only ("no broker dispatch exists"
 *     in /api/trading/action-order).
 *  4. No broker adapter or live-enable flag exists.
 *
 * Guardrails encoded here (safety by construction): single-leg only (`.strict()`
 * rejects a legs[] array), LIMIT only (market option orders disallowed),
 * positive-integer contracts, and REQUIRED `max_premium_usd` + `max_loss_usd`
 * (defined risk). Do NOT consume this from a loop/adapter until 1–4 are closed.
 */
export const OptionOrderIntentSchema = z
  .object({
    /** Buy/sell + open/close action. */
    action: z.enum(['buy_to_open', 'sell_to_close', 'sell_to_open', 'buy_to_close']),
    underlying: z
      .string()
      .trim()
      .regex(/^[A-Z]{1,6}$/, 'underlying must be a 1-6 letter uppercase ticker'),
    option_type: z.enum(['CALL', 'PUT']),
    expiration: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'expiration must be YYYY-MM-DD')
      .refine((s) => !Number.isNaN(Date.parse(s)), 'expiration must be a valid date'),
    strike: z.number().positive().finite(),
    contracts: z.number().int().positive(),
    /** LIMIT only — market option orders are disallowed by design. */
    order_type: z.literal('limit').default('limit'),
    price_effect: z.enum(['debit', 'credit']),
    /** Limit price per share (× 100 = per-contract cost). */
    limit_price: z.number().positive().finite(),
    /** Hard cap on total premium outlay in USD — sizing guard. */
    max_premium_usd: z.number().positive().finite(),
    /** Defined maximum loss in USD the operator accepts on this position. */
    max_loss_usd: z.number().positive().finite(),
    /** Human-readable strategy name for the audit trail. */
    strategy_label: z.string().trim().min(1).max(120),
    /** UUID of the options-flow / price event that sourced this intent (audit link). */
    source_signal_id: z.string().uuid().nullable().optional(),
    source: z.enum(['SANDBOX', 'RESEARCH']).default('SANDBOX'),
  })
  .strict();
export type OptionOrderIntent = z.infer<typeof OptionOrderIntentSchema>;

/** Expectancy in R units: E = (Win% * R) − (Loss% * 1). */
export function computeExpectancy(winRate: number, rMultiple: number): number {
  return winRate * rMultiple - (1 - winRate);
}

/** Raw Kelly fraction: f = W − (1−W)/R. May be negative (edge-less setup). */
export function kellyFraction(winRate: number, rMultiple: number): number {
  return winRate - (1 - winRate) / rMultiple;
}

/**
 * The single choke point for position sizing. Conservative half-Kelly,
 * floored at 0, hard-capped at HARD_CAP_FRACTION. Every staging path MUST
 * size through this function.
 */
export function clampPositionFraction(rawKelly: number): number {
  return Math.max(0, Math.min(HARD_CAP_FRACTION, rawKelly * 0.5));
}

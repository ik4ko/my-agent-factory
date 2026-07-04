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
export type OrderSource = 'SANDBOX' | 'LIVE';

/** A staged (NOT executed) Robinhood-format order awaiting human review. */
export interface RobinhoodStagedOrder {
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
  source: z.enum(['SANDBOX', 'LIVE']).optional(),
});
export type StageOrderInput = z.infer<typeof StageOrderInputSchema>;

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

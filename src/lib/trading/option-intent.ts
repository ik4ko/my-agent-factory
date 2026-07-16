import { OptionOrderIntentSchema, type OptionOrderIntent } from '@/lib/types/trading.types';

/**
 * Option-intent parse + defined-risk validation — the trading-lane analogue of
 * execution/order-intent.ts (equity). PURE: regex + zod + arithmetic, no LLM,
 * no DB, no broker. It turns a strategy brain's text into a validated,
 * defined-risk `OptionOrderIntent`.
 *
 * IT DOES NOT STAGE OR EXECUTE. Persistence now lives in `src/lib/trading/stage.ts`
 * against the additive `staged_orders` migration fields. Live options
 * execution stays impossible regardless (no adapter option-order method) —
 * `liveExecutable` is hard-wired false.
 */

export interface OptionIntentResult {
  intent: OptionOrderIntent | null;
  /** Reject reason when intent is null (never throws — null-preferring). */
  reason?: string;
  /** Always false. This codebase cannot execute options; staging is the ceiling. */
  liveExecutable: false;
}

// One machine-readable line the strategy brain emits ONLY when it wants to stage
// an option proposal:  OPTION_INTENT: { ...json matching OptionOrderIntentSchema... }
const OPTION_BLOCK = /OPTION_INTENT\s*:\s*(\{[\s\S]*?\})/;

/**
 * Defined-risk guardrails beyond the schema's structural checks. Returns a
 * human-readable reject reason, or null when the intent is acceptable to STAGE
 * (not execute). Enforces: options-flow-derived intents must carry the source
 * event id; total premium must fit the declared cap; max loss cannot exceed the
 * premium cap (no undefined risk); and naked short opens are rejected outright.
 */
export function validateDefinedRisk(intent: OptionOrderIntent, fromOptionsFlow: boolean): string | null {
  if (fromOptionsFlow && !intent.source_signal_id) {
    return 'options-flow-derived intent is missing source_signal_id (audit link required)';
  }
  // Naked short opens carry theoretically-unbounded risk — never stageable here.
  if (intent.action === 'sell_to_open') {
    return 'naked short-open options are not permitted (undefined risk)';
  }
  const premiumUsd = intent.contracts * intent.limit_price * 100;
  if (premiumUsd > intent.max_premium_usd) {
    return `premium outlay $${Math.round(premiumUsd).toLocaleString()} exceeds max_premium_usd $${Math.round(intent.max_premium_usd).toLocaleString()}`;
  }
  // For a long debit position, defined max loss is the premium paid; it must not
  // exceed the premium cap, or risk is not actually defined.
  if (intent.max_loss_usd > intent.max_premium_usd) {
    return `max_loss_usd $${Math.round(intent.max_loss_usd).toLocaleString()} exceeds max_premium_usd (risk not defined)`;
  }
  return null;
}

/**
 * Extract and validate an `OPTION_INTENT` block from strategy text. Returns a
 * validated intent or a reason. `sourceSignalId` (the options-flow / price
 * event id from the trigger) is injected when the model omitted it, and
 * `source` is FORCED to 'SANDBOX' — live options are disabled by construction.
 */
export function extractOptionOrderIntent(
  text: string,
  opts: { sourceSignalId?: string | null; fromOptionsFlow?: boolean } = {},
): OptionIntentResult {
  const block = text.match(OPTION_BLOCK);
  if (!block) return { intent: null, reason: 'no OPTION_INTENT block', liveExecutable: false };

  let raw: unknown;
  try {
    raw = JSON.parse(block[1]);
  } catch {
    return { intent: null, reason: 'OPTION_INTENT JSON malformed', liveExecutable: false };
  }

  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (opts.sourceSignalId && obj.source_signal_id == null) obj.source_signal_id = opts.sourceSignalId;
    obj.source = 'SANDBOX'; // live options are disabled regardless of model output
  }

  const parsed = OptionOrderIntentSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      intent: null,
      reason: `OPTION_INTENT failed schema: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
      liveExecutable: false,
    };
  }

  const rejected = validateDefinedRisk(parsed.data, opts.fromOptionsFlow ?? false);
  if (rejected) return { intent: null, reason: rejected, liveExecutable: false };

  return { intent: parsed.data, liveExecutable: false };
}

/**
 * Human-readable, audit-friendly summary of a validated option intent. This is
 * the label a staged row / Telegram message SHOULD carry once the migration
 * lands — surfaced now so the "not live executable" framing is defined in one
 * place. Pure string builder; no side effects.
 */
export function describeOptionIntent(intent: OptionOrderIntent): string {
  const premiumUsd = intent.contracts * intent.limit_price * 100;
  return [
    'OPTIONS INTENT — NOT LIVE EXECUTABLE (staged for decision only)',
    `${intent.action} ${intent.contracts}x ${intent.underlying} ${intent.expiration} ${intent.strike} ${intent.option_type} @ ${intent.limit_price} ${intent.price_effect} (LIMIT)`,
    `est premium ~$${Math.round(premiumUsd).toLocaleString()} · max premium $${Math.round(intent.max_premium_usd).toLocaleString()} · max loss $${Math.round(intent.max_loss_usd).toLocaleString()}`,
    `strategy: ${intent.strategy_label}${intent.source_signal_id ? ` · signal ${intent.source_signal_id}` : ''}`,
  ].join(' · ');
}

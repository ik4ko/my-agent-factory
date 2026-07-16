import { randomUUID } from 'crypto';
import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { extractOptionOrderIntent, describeOptionIntent, validateDefinedRisk } from '@/lib/trading/option-intent';
import {
  OptionOrderIntentSchema,
  TradeParamsSchema,
  computeExpectancy,
  kellyFraction,
  clampPositionFraction,
  type TradeParams,
  type RobinhoodStagedOrder,
  type OrderSource,
  type OptionOrderIntent,
} from '@/lib/types/trading.types';
import type { OptionIntentAction, OptionPriceEffect } from '@/lib/types/database.types';
import { getActivePortfolioBalance } from '@/lib/market/portfolio';
import type { PipelineContext } from '@/lib/pipeline/types';

/**
 * Order staging â€” the Executor's deterministic scan of Codex's ANALYSIS text.
 *
 * No LLM in this module: extraction is regex + zod, sizing is pure math
 * routed through the frozen 2% cap, and the result is an immutable PENDING
 * row in `staged_orders`. Nothing here (or anywhere) submits orders.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

/**
 * Extract trade parameters from analysis text.
 * Primary path: the mandated one-line machine block
 *   TRADE_PARAMS: { ...json... }
 * Fallback: conservative prose heuristics (ticker + strike + CALL/PUT +
 * YYYY-MM-DD + debit). Returns null when nothing trustworthy is found â€”
 * staging nothing is always preferable to staging garbage.
 */
export function extractTradeParams(analysisText: string): TradeParams | null {
  // Primary: TRADE_PARAMS JSON block.
  const block = analysisText.match(/TRADE_PARAMS\s*:\s*(\{[^}]*\})/);
  if (block) {
    try {
      const parsed = TradeParamsSchema.safeParse(JSON.parse(block[1]));
      if (parsed.success) return parsed.data;
    } catch {
      /* malformed JSON â€” fall through to heuristics */
    }
  }

  // Fallback heuristics â€” every field must be found or we bail.
  const underlying = analysisText.match(/\b(?:ticker|underlying|symbol)\b[:\s]+\$?([A-Z]{1,6})\b/i)?.[1]?.toUpperCase();
  const optionType = analysisText.match(/\b(CALL|PUT)S?\b/i)?.[1]?.toUpperCase() as 'CALL' | 'PUT' | undefined;
  const strike = analysisText.match(/\bstrike\b[:\s]*\$?(\d+(?:\.\d+)?)/i)?.[1];
  const expiration = analysisText.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  const debit = analysisText.match(/\b(?:max(?:imum)?\s+entry\s+debit|debit\s+limit|entry\s+debit)\b[:\s]*\$?(\d+(?:\.\d+)?)/i)?.[1];
  const winRate = analysisText.match(/\bwin[\s-]?rate\b[^0-9]{0,12}(\d{1,2}(?:\.\d+)?)\s*%/i)?.[1];
  const rMultiple = analysisText.match(/\bR(?:-multiple)?\b[^0-9]{0,12}(\d+(?:\.\d+)?)/i)?.[1];

  if (!underlying || !optionType || !strike || !expiration || !debit || !winRate || !rMultiple) {
    return null;
  }
  const candidate = TradeParamsSchema.safeParse({
    underlying,
    option_type: optionType,
    strike: Number(strike),
    expiration,
    max_entry_debit: Number(debit),
    win_rate: Number(winRate) / 100,
    r_multiple: Number(rMultiple),
  });
  return candidate.success ? candidate.data : null;
}

export interface StageResult {
  staged: RobinhoodStagedOrder | RobinhoodStagedOptionOrder | null;
  /** Human-readable reason when nothing was staged. */
  reason?: string;
}

export interface RobinhoodStagedOptionOrder extends Omit<RobinhoodStagedOrder, 'kelly_fraction' | 'expectancy' | 'win_rate' | 'r_multiple' | 'source'> {
  source: 'SANDBOX';
  intent_kind: 'option_intent';
  action: OptionIntentAction;
  contracts: number;
  price_effect: OptionPriceEffect;
  max_premium_usd: number;
  max_loss_usd: number;
  strategy_label: string;
  source_signal_id: string | null;
  kelly_fraction: number | null;
  expectancy: number | null;
  win_rate: number | null;
  r_multiple: number | null;
}

function isOptionIntentStagedOrder(order: RobinhoodStagedOrder | RobinhoodStagedOptionOrder): order is RobinhoodStagedOptionOrder {
  return 'intent_kind' in order && order.intent_kind === 'option_intent';
}

function validatePersistableOptionIntentRow(order: RobinhoodStagedOptionOrder): string | null {
  const reconstructed = OptionOrderIntentSchema.safeParse({
    action: order.action,
    underlying: order.underlying,
    option_type: order.option_type,
    expiration: order.expiration,
    strike: order.strike,
    contracts: order.contracts,
    order_type: 'limit',
    price_effect: order.price_effect,
    limit_price: order.limit_price,
    max_premium_usd: order.max_premium_usd,
    max_loss_usd: order.max_loss_usd,
    strategy_label: order.strategy_label,
    source_signal_id: order.source_signal_id,
    source: order.source,
  });

  if (!reconstructed.success) {
    return `option-intent row failed local schema check: ${reconstructed.error.issues[0]?.message ?? 'invalid option intent row'}`;
  }

  if (reconstructed.data.source !== 'SANDBOX') {
    return `option-intent rows must persist as SANDBOX (got ${reconstructed.data.source})`;
  }

  const rejected = validateDefinedRisk(reconstructed.data, true);
  if (rejected) {
    return `option-intent row failed local contract: ${rejected}`;
  }

  return null;
}

/** Pure assembly: params + live equity â†’ sized, PENDING order. Equity is an
 *  explicit required input (no hidden static default in this module) so every
 *  caller consciously sources it from getActivePortfolioBalance. */
export function buildStagedOrder(
  params: TradeParams,
  options: { pipelineId: string | null; source: OrderSource; equityUsd: number },
): StageResult {
  if (!Number.isFinite(options.equityUsd) || options.equityUsd <= 0) {
    return { staged: null, reason: `invalid equity base ${options.equityUsd} â€” sizing refused` };
  }
  const expectancy = computeExpectancy(params.win_rate, params.r_multiple);
  if (expectancy <= 0) {
    return {
      staged: null,
      reason: `expectancy E=${expectancy.toFixed(3)} â‰¤ 0 (W=${params.win_rate}, R=${params.r_multiple}) â€” constraint 1 rejects the setup`,
    };
  }

  const rawKelly = kellyFraction(params.win_rate, params.r_multiple);
  const fraction = clampPositionFraction(rawKelly); // constraint 2: half-Kelly, 2% hard cap
  if (fraction <= 0) {
    return { staged: null, reason: `Kelly fraction ${rawKelly.toFixed(3)} â‰¤ 0 â€” no positive edge to size` };
  }

  return {
    staged: {
      id: randomUUID(),
      underlying: params.underlying,
      option_type: params.option_type,
      strike: params.strike,
      expiration: params.expiration,
      execution_type: 'LIMIT',
      limit_price: params.max_entry_debit,
      calculated_position_size_usd: Math.round(options.equityUsd * fraction * 100) / 100,
      human_approval_status: 'PENDING', // constraint 3: staged, never executed
      pipeline_id: options.pipelineId,
      kelly_fraction: Math.round(fraction * 10_000) / 10_000,
      expectancy: Math.round(expectancy * 1_000) / 1_000,
      win_rate: params.win_rate,
      r_multiple: params.r_multiple,
      source: options.source,
      created_at: new Date().toISOString(),
    },
  };
}

/** Build a staged option order row. */
export function buildStagedOptionOrder(
  intent: OptionOrderIntent,
  options: { pipelineId: string | null },
): RobinhoodStagedOptionOrder {
  return {
    id: randomUUID(),
    underlying: intent.underlying,
    option_type: intent.option_type,
    strike: intent.strike,
    expiration: intent.expiration,
    execution_type: 'LIMIT',
    limit_price: intent.limit_price,
    calculated_position_size_usd: intent.max_loss_usd,
    human_approval_status: 'PENDING',
    pipeline_id: options.pipelineId,
    kelly_fraction: null,
    expectancy: null,
    win_rate: null,
    r_multiple: null,
    source: 'SANDBOX',
    intent_kind: 'option_intent',
    action: intent.action,
    contracts: intent.contracts,
    price_effect: intent.price_effect,
    max_premium_usd: intent.max_premium_usd,
    max_loss_usd: intent.max_loss_usd,
    strategy_label: intent.strategy_label,
    source_signal_id: intent.source_signal_id ?? null,
    created_at: new Date().toISOString(),
  };
}

/** Persist a staged order. Insert-only â€” approval flips happen elsewhere, by humans. */
export async function persistStagedOrder(order: RobinhoodStagedOrder | RobinhoodStagedOptionOrder): Promise<void> {
  if (isOptionIntentStagedOrder(order)) {
    const reason = validatePersistableOptionIntentRow(order);
    if (reason) {
      throw new Error(`staged_orders option-intent row failed before DB insert: ${reason}`);
    }
  }
  const { error } = await db().from('staged_orders').insert(order);
  if (error) throw new Error(error.message ?? 'staged_orders insert failed');
}

/**
 * Pipeline entry point: the Executor scans the ANALYSIS output and stages
 * (or refuses to stage) an order. Never throws â€” a staging failure must not
 * kill the pipeline's EXECUTION narrative stage.
 */
export async function stageOrderFromAnalysis(
  context: PipelineContext,
  analysisText: string | null,
  agentId: string | null,
): Promise<StageResult> {
  try {
    if (!analysisText) {
      await hermesLog('warn', 'Executor scan: no analysis text available - nothing staged', agentId);
      return { staged: null, reason: 'no analysis text' };
    }

    if (/OPTION_INTENT\s*:/i.test(analysisText)) {
      // Every option_intent row the DB accepts requires a non-null source_signal_id
      // (staged_orders_option_intent_required + FK to events). Enforce that audit
      // link here so a missing id fails with a clean validator reason instead of a
      // cryptic check-constraint violation at insert time.
      const parsed = extractOptionOrderIntent(analysisText, { fromOptionsFlow: true });
      if (!parsed.intent) {
        await hermesLog('warn', `Executor scan: ${parsed.reason ?? 'invalid OPTION_INTENT block'}`, agentId);
        return { staged: null, reason: parsed.reason ?? 'invalid OPTION_INTENT block' };
      }

      const staged = buildStagedOptionOrder(parsed.intent, { pipelineId: context.id });
      await persistStagedOrder(staged);
      await hermesLog('success', `Option intent staged for ${staged.underlying}. ${describeOptionIntent(parsed.intent)}`, agentId);
      return { staged };
    }

    const params = extractTradeParams(analysisText);
    if (!params) {
      await hermesLog(
        'warn',
        'Executor scan: no valid TRADE_PARAMS block or extractable parameters in analysis - nothing staged',
        agentId,
      );
      return { staged: null, reason: 'no extractable trade parameters' };
    }

    // Live portfolio balance - the 2% cap now allocates against real liquid
    // cash, not a static constant (adapter guarantees a positive number).
    const equityUsd = await getActivePortfolioBalance();

    const result = buildStagedOrder(params, {
      pipelineId: context.id,
      source: context.simulate ? 'SANDBOX' : 'LIVE',
      equityUsd,
    });
    if (!result.staged) {
      await hermesLog('warn', `Executor scan: ${result.reason}`, agentId);
      return result;
    }

    await persistStagedOrder(result.staged);
    await hermesLog(
      'success',
      `Order staged for underlying ${result.staged.underlying}. Kelly allocation: ${((result.staged.kelly_fraction ?? 0) * 100).toFixed(2)}%. Awaiting manual verification.`,
      agentId,
    );
    return result;
  } catch (err) {
    const line = String(err).replace(/\s+/g, ' ').slice(0, 160);
    const setupMissing = /column .* does not exist|relation .* does not exist|staged_orders insert failed/i.test(line);
    const reason = setupMissing
      ? 'staged_orders option-intent migration missing; apply supabase/migrations/20260716_staged_orders_option_intent_fields.sql'
      : line;
    await hermesLog('error', `Order staging failed: ${reason}`, agentId);
    return { staged: null, reason };
  }
}


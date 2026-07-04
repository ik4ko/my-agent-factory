import { randomUUID } from 'crypto';
import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import {
  TradeParamsSchema,
  computeExpectancy,
  kellyFraction,
  clampPositionFraction,
  DEFAULT_PAPER_EQUITY_USD,
  type TradeParams,
  type RobinhoodStagedOrder,
  type OrderSource,
} from '@/lib/types/trading.types';
import type { PipelineContext } from '@/lib/pipeline/types';

/**
 * Order staging — the Executor's deterministic scan of Codex's ANALYSIS text.
 *
 * No LLM in this module: extraction is regex + zod, sizing is pure math
 * routed through the frozen 2% cap, and the result is an immutable PENDING
 * row in `staged_orders`. Nothing here (or anywhere) submits orders.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

function paperEquityUsd(): number {
  const env = Number(process.env.PAPER_EQUITY_USD);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_PAPER_EQUITY_USD;
}

/**
 * Extract trade parameters from analysis text.
 * Primary path: the mandated one-line machine block
 *   TRADE_PARAMS: { ...json... }
 * Fallback: conservative prose heuristics (ticker + strike + CALL/PUT +
 * YYYY-MM-DD + debit). Returns null when nothing trustworthy is found —
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
      /* malformed JSON — fall through to heuristics */
    }
  }

  // Fallback heuristics — every field must be found or we bail.
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
  staged: RobinhoodStagedOrder | null;
  /** Human-readable reason when nothing was staged. */
  reason?: string;
}

/** Pure assembly: params → sized, PENDING order. Exported for the API route. */
export function buildStagedOrder(
  params: TradeParams,
  options: { pipelineId: string | null; source: OrderSource },
): StageResult {
  const expectancy = computeExpectancy(params.win_rate, params.r_multiple);
  if (expectancy <= 0) {
    return {
      staged: null,
      reason: `expectancy E=${expectancy.toFixed(3)} ≤ 0 (W=${params.win_rate}, R=${params.r_multiple}) — constraint 1 rejects the setup`,
    };
  }

  const rawKelly = kellyFraction(params.win_rate, params.r_multiple);
  const fraction = clampPositionFraction(rawKelly); // constraint 2: half-Kelly, 2% hard cap
  if (fraction <= 0) {
    return { staged: null, reason: `Kelly fraction ${rawKelly.toFixed(3)} ≤ 0 — no positive edge to size` };
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
      calculated_position_size_usd: Math.round(paperEquityUsd() * fraction * 100) / 100,
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

/** Persist a staged order. Insert-only — approval flips happen elsewhere, by humans. */
export async function persistStagedOrder(order: RobinhoodStagedOrder): Promise<void> {
  const { error } = await db().from('staged_orders').insert(order);
  if (error) throw new Error(error.message ?? 'staged_orders insert failed');
}

/**
 * Pipeline entry point: the Executor scans the ANALYSIS output and stages
 * (or refuses to stage) an order. Never throws — a staging failure must not
 * kill the pipeline's EXECUTION narrative stage.
 */
export async function stageOrderFromAnalysis(
  context: PipelineContext,
  analysisText: string | null,
  agentId: string | null,
): Promise<StageResult> {
  try {
    if (!analysisText) {
      await hermesLog('warn', 'Executor scan: no analysis text available — nothing staged', agentId);
      return { staged: null, reason: 'no analysis text' };
    }

    const params = extractTradeParams(analysisText);
    if (!params) {
      await hermesLog(
        'warn',
        'Executor scan: no valid TRADE_PARAMS block or extractable parameters in analysis — nothing staged',
        agentId,
      );
      return { staged: null, reason: 'no extractable trade parameters' };
    }

    const result = buildStagedOrder(params, {
      pipelineId: context.id,
      source: context.simulate ? 'SANDBOX' : 'LIVE',
    });
    if (!result.staged) {
      await hermesLog('warn', `Executor scan: ${result.reason}`, agentId);
      return result;
    }

    await persistStagedOrder(result.staged);
    await hermesLog(
      'success',
      `Order staged for underlying ${result.staged.underlying}. Kelly allocation: ${(result.staged.kelly_fraction * 100).toFixed(2)}%. Awaiting manual verification.`,
      agentId,
    );
    return result;
  } catch (err) {
    const line = String(err).replace(/\s+/g, ' ').slice(0, 160);
    await hermesLog('error', `Order staging failed: ${line}`, agentId);
    return { staged: null, reason: line };
  }
}

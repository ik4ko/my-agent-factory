import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { startPipeline, executeStep } from '@/lib/pipeline/engine';
import {
  MAX_DAILY_AUTONOMOUS_TRADES,
  countAutonomousIgnitionsToday,
} from '@/lib/pipeline/autonomous-runner';

/**
 * Multi-ticker sweep orchestrator — Phase 8, Objective 2.
 *
 * Wraps the EXISTING single-symbol pipeline (startPipeline/executeStep are
 * untouched) in a watchlist loop with three isolation guarantees:
 *
 *  1. PER-TICKER ERROR BOUNDARY — every symbol runs in its own try/catch;
 *     a failure on $SPY records a result and CONTINUES with $NVDA.
 *  2. PER-TICKER TIME BUDGET — a slow ticker (Yahoo stall, model latency)
 *     is DETACHED at the budget, not awaited: the sweep records the hand-off
 *     and moves on while that pipeline keeps advancing itself in the
 *     background via its own step chain. Nothing blocks the loop.
 *  3. SPLIT-EXECUTION ACROSS INVOCATIONS — symbols are pulled
 *     least-recently-processed-first and touched on dispatch, so a `limit`
 *     smaller than the watchlist rotates fairly across cron pulses. That is
 *     the Vercel wall-clock strategy: one invocation, few tickers, cursor
 *     lives in the DB (`updated_at`), no in-memory state to lose.
 *
 * Autonomous sweeps respect the same daily ceiling as the autonomous runner
 * (checked from the DB before EVERY ignition, so a sweep can't blow through
 * the cap mid-loop).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

const PER_TICKER_BUDGET_MS = { sim: 20_000, live: 120_000 } as const;

export interface TickerRunResult {
  symbol: string;
  status: 'dispatched' | 'detached' | 'failed' | 'skipped';
  pipelineId?: string;
  detail?: string;
}

export interface WatchlistSweepResult {
  startedAt: string;
  finishedAt: string;
  attempted: number;
  dispatched: number;
  failed: number;
  results: TickerRunResult[];
}

export interface SweepOptions {
  /** Sandbox by default — live sweeps are an explicit choice. */
  simulate?: boolean;
  trigger?: 'manual' | 'autonomous';
  /** Max symbols this invocation (rotation cursor handles the rest). */
  limit?: number;
}

/** Active symbols, least-recently-processed first (the rotation cursor). */
export async function getActiveWatchlist(limit = 10): Promise<string[]> {
  const { data, error } = await db()
    .from('ticker_watchlist')
    .select('symbol')
    .eq('is_active', true)
    .order('updated_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message ?? 'ticker_watchlist read failed');
  return ((data ?? []) as Array<{ symbol: string }>).map((r) => r.symbol);
}

/** Advance the rotation cursor for a symbol. */
async function touchTicker(symbol: string): Promise<void> {
  await db()
    .from('ticker_watchlist')
    .update({ updated_at: new Date().toISOString() })
    .eq('symbol', symbol);
}

/** Race work against a wall-clock budget WITHOUT cancelling it: on timeout
 *  the promise is detached (kept alive, errors swallowed into the log). */
async function withBudget(work: Promise<void>, ms: number): Promise<'settled' | 'detached'> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const outcome = await Promise.race([
    work.then(() => 'settled' as const),
    new Promise<'detached'>((resolve) => {
      timer = setTimeout(() => resolve('detached'), ms);
    }),
  ]);
  if (timer) clearTimeout(timer);
  if (outcome === 'detached') {
    // Keep the detached pipeline from becoming an unhandled rejection.
    work.catch((err) =>
      hermesLog('warn', `Detached pipeline error: ${String(err).slice(0, 120)}`),
    );
  }
  return outcome;
}

/**
 * One sweep: read active symbols, ignite the standard pipeline per symbol,
 * isolate every failure, never block on a slow ticker.
 */
export async function runWatchlistSweep(options: SweepOptions = {}): Promise<WatchlistSweepResult> {
  const simulate = options.simulate ?? true;
  const trigger = options.trigger ?? 'manual';
  const limit = options.limit ?? 10;
  const startedAt = new Date().toISOString();
  const results: TickerRunResult[] = [];

  let symbols: string[] = [];
  try {
    symbols = await getActiveWatchlist(limit);
  } catch (err) {
    await hermesLog('error', `Sweep aborted — watchlist unreadable: ${String(err).slice(0, 120)}`);
    return { startedAt, finishedAt: new Date().toISOString(), attempted: 0, dispatched: 0, failed: 1, results };
  }

  await hermesLog(
    'info',
    `Watchlist sweep started — ${symbols.length} symbol(s): ${symbols.map((s) => `$${s}`).join(' ')} ${simulate ? '(SANDBOX)' : '(LIVE)'}`,
  );

  for (const symbol of symbols) {
    // Isolated async context per ticker: nothing thrown here reaches the loop.
    try {
      if (trigger === 'autonomous') {
        const ignitions = await countAutonomousIgnitionsToday();
        if (ignitions >= MAX_DAILY_AUTONOMOUS_TRADES) {
          results.push({ symbol, status: 'skipped', detail: 'daily autonomous ceiling reached' });
          await hermesLog('warn', `Sweep: $${symbol} skipped — autonomous ceiling ${MAX_DAILY_AUTONOMOUS_TRADES}/day reached`);
          continue; // remaining symbols record the same skip — no silent drops
        }
      }

      const objective = `Watchlist scan: evaluate a defined-risk options entry on $${symbol} under current regime conditions`;
      const dispatch = await startPipeline(objective, { simulate, trigger });
      await touchTicker(symbol);

      const budget = simulate ? PER_TICKER_BUDGET_MS.sim : PER_TICKER_BUDGET_MS.live;
      const outcome = await withBudget(executeStep(dispatch), budget);

      if (outcome === 'detached') {
        await hermesLog(
          'warn',
          `Sweep: $${symbol} exceeded ${Math.round(budget / 1000)}s budget — detached, pipeline ${dispatch.context.id.slice(0, 8)} continues in background`,
        );
        results.push({ symbol, status: 'detached', pipelineId: dispatch.context.id, detail: `budget ${budget}ms exceeded` });
      } else {
        results.push({ symbol, status: 'dispatched', pipelineId: dispatch.context.id });
      }
    } catch (err) {
      const detail = String(err).replace(/\s+/g, ' ').slice(0, 160);
      await hermesLog('error', `Sweep: $${symbol} failed — ${detail} — continuing with remaining symbols`);
      results.push({ symbol, status: 'failed', detail });
    }
  }

  const dispatched = results.filter((r) => r.status === 'dispatched' || r.status === 'detached').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  await hermesLog(
    'success',
    `Watchlist sweep complete — ${dispatched}/${results.length} ignited, ${failed} failed, ${results.length - dispatched - failed} skipped`,
  );

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    attempted: results.length,
    dispatched,
    failed,
    results,
  };
}

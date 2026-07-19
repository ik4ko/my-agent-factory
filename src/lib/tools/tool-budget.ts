import { getAdminClient } from '@/lib/supabase/admin';

/**
 * Per-tool-call budget gate — the anti-runaway counterpart to
 * token-ledger.ts's LLM spend gates, built BEFORE anything autonomous can
 * call tools. Counts today's (UTC) `tool_call` rows in feedback_events
 * against LIVE_TOOLS_DAILY_CALL_CAP (default 200; 0 disables tools).
 *
 * Failure policy — deliberately different from the LLM gates: LLM gates
 * fail CLOSED because a missed check spends real dollars; this gate fails
 * OPEN on a ledger outage because tool calls are free/near-free and the cap
 * exists to stop runaway loops, not billing. A denial is not an error: it
 * returns a message the model reads (same degradation contract as a failed
 * tool), so the conversation always completes.
 */

const DEFAULT_DAILY_CAP = 200;
const COUNT_TTL_MS = 60_000;

let countCache: { day: string; at: number; count: number } | null = null;

function utcDayStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export function dailyToolCallCap(): number {
  const raw = process.env.LIVE_TOOLS_DAILY_CALL_CAP;
  if (raw === undefined || raw.trim() === '') return DEFAULT_DAILY_CAP;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : DEFAULT_DAILY_CAP;
}

/** Returns null when the call may proceed, or a model-readable denial. */
export async function consumeToolBudget(): Promise<string | null> {
  const cap = dailyToolCallCap();
  if (cap === 0) return 'Live tools are disabled on this system (LIVE_TOOLS_DAILY_CALL_CAP=0). Answer from what you already know.';

  const day = utcDayStartIso();
  try {
    if (!countCache || countCache.day !== day || Date.now() - countCache.at >= COUNT_TTL_MS) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = getAdminClient() as any;
      const { count, error } = await db
        .from('feedback_events')
        .select('id', { count: 'exact', head: true })
        .eq('kind', 'tool_call')
        .gte('created_at', day);
      if (error) throw new Error(error.message);
      countCache = { day, at: Date.now(), count: count ?? 0 };
    }
    if (countCache.count >= cap) {
      return `The daily live-tool budget is exhausted (${cap} calls/day, LIVE_TOOLS_DAILY_CALL_CAP). Answer from what you already know and mention live data is unavailable until tomorrow.`;
    }
    // Local increment between refreshes so a burst inside the 60s cache
    // window still counts against the cap.
    countCache.count += 1;
    return null;
  } catch (err) {
    console.warn('[tool-budget] check failed open:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** TEST-ONLY: reset the cached counter. */
export function __resetToolBudgetCacheForTest(): void {
  countCache = null;
}

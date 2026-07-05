// Regime Controller — 100% deterministic. Aggregates recent `events` and
// mutates risk_state ONLY to tighten: strip a symbol from the effective
// allowlist, shrink its effective max-trade-size, or halt everything on a
// cluster of severe events. It NEVER sets trading_enabled and never raises
// a cap above the operator's base (env / loop config) — relaxation only
// removes an override, which just falls back to that base, and only after
// a cooldown once the condition that caused it has cleared.
import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { notify } from '@/lib/comms/transport';
import type { EventRow, EventSeverity, Regime, SymbolOverride } from '@/lib/types/database.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

const LOOKBACK_MS = 60 * 60_000; // 1 hour
const COOLDOWN_MS = Number(process.env.REGIME_COOLDOWN_MS ?? 30 * 60_000); // 30 min
const REGIME_HALT_PREFIX = '[REGIME]';

function bearishThreshold(): number {
  const v = Number(process.env.REGIME_BEARISH_THRESHOLD);
  return Number.isFinite(v) ? v : -0.7;
}
function sizeMultiplier(): number {
  const v = Number(process.env.REGIME_SIZE_MULTIPLIER);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.5;
}

const SEVERITY_RANK: Record<EventSeverity, number> = { low: 0, med: 1, high: 2, critical: 3 };

interface SymbolAggregate {
  symbol: string;
  worstSeverity: EventSeverity;
  minSentiment: number;
}

function aggregateBySymbol(events: EventRow[]): SymbolAggregate[] {
  const bySymbol = new Map<string, SymbolAggregate>();
  for (const e of events) {
    if (!e.symbol) continue;
    const sentiment = Number((e.payload as { sentiment?: number })?.sentiment ?? 0);
    const existing = bySymbol.get(e.symbol);
    if (!existing) {
      bySymbol.set(e.symbol, { symbol: e.symbol, worstSeverity: e.severity ?? 'low', minSentiment: sentiment });
    } else {
      if (e.severity && SEVERITY_RANK[e.severity] > SEVERITY_RANK[existing.worstSeverity]) existing.worstSeverity = e.severity;
      existing.minSentiment = Math.min(existing.minSentiment, sentiment);
    }
  }
  return [...bySymbol.values()];
}

export interface RegimeResult {
  regime: Regime;
  changes: string[];
}

/** Full evaluation pass — call once per news-ingest cycle. Never throws:
 *  any internal error is logged and treated as a no-op for this cycle
 *  (existing tighter state, if any, is left in place — never loosened). */
export async function runRegimeController(): Promise<RegimeResult> {
  try {
    const { data: risk } = await db().from('risk_state').select('*').eq('id', 1).maybeSingle();
    if (!risk) return { regime: 'NORMAL', changes: [] };

    const cutoff = new Date(Date.now() - LOOKBACK_MS).toISOString();
    const { data: events } = await db()
      .from('events')
      .select('*')
      .eq('type', 'news')
      .gte('created_at', cutoff);
    const actionable = ((events ?? []) as EventRow[]).filter((e) => Boolean((e.payload as { actionable?: boolean })?.actionable));

    const threshold = bearishThreshold();
    const changes: string[] = [];
    const overrides: Record<string, SymbolOverride> = { ...(risk.symbol_overrides ?? {}) };
    const now = new Date().toISOString();

    // Per-symbol tightening.
    for (const agg of aggregateBySymbol(actionable)) {
      const bearish = agg.minSentiment <= threshold;
      const severe = agg.worstSeverity === 'critical' || (agg.worstSeverity === 'high' && bearish);

      if (severe) {
        if (!overrides[agg.symbol]?.blocked) {
          overrides[agg.symbol] = { blocked: true, reason: `${agg.worstSeverity} severity, sentiment ${agg.minSentiment.toFixed(2)}`, since: now };
          changes.push(`blocked ${agg.symbol} (${overrides[agg.symbol].reason})`);
        }
      } else if (bearish) {
        if (!overrides[agg.symbol]) {
          overrides[agg.symbol] = { sizeMultiplier: sizeMultiplier(), reason: `bearish sentiment ${agg.minSentiment.toFixed(2)}`, since: now };
          changes.push(`tightened ${agg.symbol} size ×${sizeMultiplier()} (${overrides[agg.symbol].reason})`);
        }
      }
    }

    // Relaxation — only for overrides whose trigger condition no longer
    // holds AND whose cooldown has elapsed. Never below base; this only
    // ever REMOVES a restriction, returning to the operator's base caps.
    const stillFlagged = new Set(aggregateBySymbol(actionable).filter((a) => a.minSentiment <= threshold || a.worstSeverity !== 'low').map((a) => a.symbol));
    for (const [symbol, override] of Object.entries(overrides)) {
      const age = Date.now() - new Date(override.since).getTime();
      if (!stillFlagged.has(symbol) && age >= COOLDOWN_MS) {
        delete overrides[symbol];
        changes.push(`relaxed ${symbol} (cooldown elapsed, condition cleared)`);
      }
    }

    // Market-wide cluster → CRITICAL_HALT. Triggers: any market-wide
    // (symbol-less) critical event, OR 3+ distinct symbols independently
    // blocked this cycle.
    const marketWideCritical = actionable.some((e) => !e.symbol && e.severity === 'critical');
    const blockedCount = Object.values(overrides).filter((o) => o.blocked).length;
    const criticalCluster = marketWideCritical || blockedCount >= 3;

    let halted = Boolean(risk.halted);
    let haltReason = risk.halt_reason as string | null;
    if (criticalCluster && !halted) {
      halted = true;
      haltReason = `${REGIME_HALT_PREFIX} critical news cluster (${blockedCount} symbols blocked${marketWideCritical ? ', market-wide critical event' : ''})`;
      changes.push(haltReason);
    } else if (
      halted &&
      typeof haltReason === 'string' &&
      haltReason.startsWith(REGIME_HALT_PREFIX) &&
      !criticalCluster &&
      risk.regime_updated_at &&
      Date.now() - new Date(risk.regime_updated_at).getTime() >= COOLDOWN_MS
    ) {
      // Only ever clears a halt THIS controller set — never a daily-loss or
      // manual halt, and only after the same cooldown as symbol relaxation.
      halted = false;
      haltReason = null;
      changes.push('cleared regime-triggered halt (cooldown elapsed, condition cleared)');
    }

    const regime: Regime = halted && haltReason?.startsWith(REGIME_HALT_PREFIX) ? 'CRITICAL_HALT' : Object.keys(overrides).length > 0 ? 'VOLATILE' : 'NORMAL';

    if (changes.length > 0 || regime !== risk.regime) {
      await db()
        .from('risk_state')
        .update({
          symbol_overrides: overrides,
          halted,
          halt_reason: haltReason,
          regime,
          regime_updated_at: now,
          updated_at: now,
        })
        .eq('id', 1);
      for (const change of changes) await hermesLog('warn', `[REGIME] ${change}`);
      if (regime === 'CRITICAL_HALT' && risk.regime !== 'CRITICAL_HALT') {
        await notify(`CRITICAL_HALT triggered — ${haltReason}`);
      }
    }

    return { regime, changes };
  } catch (err) {
    await hermesLog('error', `[REGIME] controller crashed — leaving prior state in place: ${String(err).replace(/\s+/g, ' ').slice(0, 160)}`);
    return { regime: 'NORMAL', changes: [] };
  }
}

/** Finnhub degraded (429/5xx/timeout/parse failure). Fail-closed: force a
 *  halt if any trade loop is armed, so nothing proceeds on stale/missing
 *  news coverage. Never emits an "all clear" itself — see markFeedRecovered. */
export async function markFeedDegraded(reason: string): Promise<void> {
  const { data: armedTradeLoops } = await db().from('loops').select('id').eq('kind', 'trade').eq('status', 'armed').limit(1);
  const shouldHalt = (armedTradeLoops ?? []).length > 0;

  const update: Record<string, unknown> = { feed_degraded: true, feed_degraded_reason: reason, updated_at: new Date().toISOString() };
  if (shouldHalt) {
    update.halted = true;
    update.halt_reason = `${REGIME_HALT_PREFIX} news feed degraded: ${reason}`;
    update.regime = 'CRITICAL_HALT';
    update.regime_updated_at = new Date().toISOString();
  }
  await db().from('risk_state').update(update).eq('id', 1);
  await hermesLog('error', `[REGIME] news feed degraded — ${reason}${shouldHalt ? ' — armed trade loops halted' : ''}`);
}

/** Feed recovered — clears the degraded flag and, if the CURRENT halt was
 *  this controller's feed-degradation halt (never any other), clears it too. */
export async function markFeedRecovered(): Promise<void> {
  const { data: risk } = await db().from('risk_state').select('halted, halt_reason').eq('id', 1).maybeSingle();
  const update: Record<string, unknown> = { feed_degraded: false, feed_degraded_reason: null, updated_at: new Date().toISOString() };
  if (risk?.halted && typeof risk.halt_reason === 'string' && risk.halt_reason.startsWith(`${REGIME_HALT_PREFIX} news feed degraded`)) {
    update.halted = false;
    update.halt_reason = null;
    update.regime = 'NORMAL';
  }
  await db().from('risk_state').update(update).eq('id', 1);
}

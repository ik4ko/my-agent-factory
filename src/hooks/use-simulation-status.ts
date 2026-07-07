'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';

export const SIMULATION_STATUS_KEY = ['simulation-status'] as const;

/** Quote sources that count as a real market feed. 'SIMULATED' (the market
 *  fetcher's offline fallback) never does. */
const LIVE_SOURCES = new Set(['FINNHUB', 'YAHOO', 'BROKER', 'ALPACA']);
/** A "live" quote older than this is stale — treat as no feed. */
const FRESHNESS_MS = 10 * 60_000;

export interface SimulationStatus {
  /** true ⇒ the control room is operating WITHOUT live market data and every
   *  trading-vocabulary element must be read as simulation/dry-run. */
  simulated: boolean;
  reason: string;
}

interface QuoteRow {
  source: string | null;
  updated_at: string | null;
}

async function fetchSimulationStatus(): Promise<SimulationStatus> {
  const supabase = createClient();
  const [quotesRes, riskRes] = await Promise.all([
    supabase.from('quotes').select('source, updated_at'),
    supabase.from('risk_state').select('feed_degraded, feed_degraded_reason, trading_enabled').eq('id', 1).maybeSingle(),
  ]);

  const risk = riskRes.data as
    | { feed_degraded: boolean | null; feed_degraded_reason: string | null; trading_enabled: boolean | null }
    | null;

  if (risk?.feed_degraded) {
    return { simulated: true, reason: `market feed degraded — ${risk.feed_degraded_reason ?? 'unspecified'}` };
  }

  const quotes = (quotesRes.data ?? []) as QuoteRow[];
  const now = Date.now();
  const liveFresh = quotes.some(
    (q) =>
      q.source != null &&
      LIVE_SOURCES.has(q.source.toUpperCase()) &&
      q.updated_at != null &&
      now - Date.parse(q.updated_at) < FRESHNESS_MS
  );

  if (!liveFresh) {
    const reason =
      quotes.length === 0
        ? 'no market feed connected — quotes cache is empty'
        : 'no fresh live quotes — feed disconnected or quote poller stopped';
    return { simulated: true, reason };
  }

  if (risk?.trading_enabled === false) {
    // Live data IS flowing, but execution is disarmed: keep the trust banner
    // up in a softer form — orders still never reach a broker.
    return { simulated: true, reason: 'live quotes flowing, but trading is DISARMED — all execution is dry-run' };
  }

  return { simulated: false, reason: 'live market feed connected and trading armed' };
}

/** Poll (30s) whether any real market data source is fresh. Errors fail
 *  CLOSED: an unknown state is reported as simulation, never as live. */
export function useSimulationStatus(): SimulationStatus & { isLoading: boolean } {
  const { data, isLoading, isError } = useQuery({
    queryKey: SIMULATION_STATUS_KEY,
    queryFn: fetchSimulationStatus,
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  if (isError) return { simulated: true, reason: 'feed status check failed — assuming simulation', isLoading: false };
  if (!data) return { simulated: true, reason: 'checking market feed…', isLoading };
  return { ...data, isLoading };
}

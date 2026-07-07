'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';

export const RISK_STATE_KEY = ['risk-state'] as const;

export interface RiskStateView {
  tradingEnabled: boolean;
  halted: boolean;
  haltReason: string | null;
  killSwitch: boolean;
  realizedPnl: number;
  regime: string;
  feedDegraded: boolean;
  blockedSymbols: string[];
  tightenedSymbols: string[];
  updatedAt: string | null;
}

interface RiskRow {
  trading_enabled: boolean | null;
  halted: boolean | null;
  halt_reason: string | null;
  kill_switch: boolean | null;
  realized_pnl: number | string | null;
  regime: string | null;
  feed_degraded: boolean | null;
  symbol_overrides: Record<string, { blocked?: boolean; sizeMultiplier?: number }> | null;
  updated_at: string | null;
}

async function fetchRiskState(): Promise<RiskStateView | null> {
  const { data, error } = await createClient()
    .from('risk_state')
    .select('trading_enabled, halted, halt_reason, kill_switch, realized_pnl, regime, feed_degraded, symbol_overrides, updated_at')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as RiskRow;
  const overrides = row.symbol_overrides ?? {};
  return {
    tradingEnabled: Boolean(row.trading_enabled),
    halted: Boolean(row.halted),
    haltReason: row.halt_reason,
    killSwitch: Boolean(row.kill_switch),
    realizedPnl: Number(row.realized_pnl ?? 0),
    regime: row.regime ?? 'NORMAL',
    feedDegraded: Boolean(row.feed_degraded),
    blockedSymbols: Object.entries(overrides).filter(([, o]) => o?.blocked).map(([s]) => s),
    tightenedSymbols: Object.entries(overrides).filter(([, o]) => !o?.blocked && o?.sizeMultiplier != null).map(([s]) => s),
    updatedAt: row.updated_at,
  };
}

/** The execution-safety choke point (risk_state row 1), polled every 15s.
 *  Shared by the Trading Room's RiskPanel and the Control Room status strip
 *  so the two can never disagree. */
export function useRiskState() {
  return useQuery({
    queryKey: RISK_STATE_KEY,
    queryFn: fetchRiskState,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
}

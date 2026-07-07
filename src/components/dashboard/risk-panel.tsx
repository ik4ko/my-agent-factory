'use client';

import { AlertOctagon, DollarSign, Gauge, ShieldBan, ShieldCheck, ShieldOff } from 'lucide-react';
import { useRiskState } from '@/hooks/use-risk-state';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Trading Room risk & PnL panel — reads the same risk_state row the
 * execution gate enforces. Read-only by design: arming/halting stays behind
 * the PIN-gated control actions, never a chart-adjacent button.
 */
export function RiskPanel() {
  const { data: risk, isLoading, isError } = useRiskState();

  if (isLoading) {
    return (
      <div className="rounded-md border border-border p-3 space-y-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-3 w-full" />
      </div>
    );
  }
  if (isError || !risk) {
    return (
      <div className="rounded-md border border-neon-red/30 bg-neon-red/[0.05] p-3 font-terminal text-[11px] text-neon-red/80" role="alert">
        Risk state unavailable — treating execution as unsafe until it loads. Refresh or check the database link.
      </div>
    );
  }

  const pnlUp = risk.realizedPnl >= 0;

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Execution safety</span>

        <span
          title="Master arm state (risk_state.trading_enabled). While disarmed, every order intent mock-executes as a dry_run audit row — nothing reaches a broker."
          aria-label={`Trading ${risk.tradingEnabled ? 'armed' : 'disarmed'}`}
        >
          <Badge variant={risk.tradingEnabled ? 'error' : 'success'}>
            {risk.tradingEnabled ? 'ARMED' : 'DISARMED · DRY-RUN'}
          </Badge>
        </span>

        {risk.killSwitch && (
          <span className="flex items-center gap-1 font-terminal text-[10px] font-bold text-neon-red" title="Kill switch engaged — all new orders blocked, open orders canceled">
            <AlertOctagon className="size-3" aria-hidden /> KILL SWITCH
          </span>
        )}

        <span
          className="flex items-center gap-1 font-terminal text-[10px]"
          title={risk.halted ? `Halted: ${risk.haltReason ?? 'no reason recorded'}` : 'Not halted — the risk gate is evaluating intents normally'}
        >
          {risk.halted ? (
            <>
              <ShieldBan className="size-3 text-neon-red" aria-hidden />
              <span className="text-neon-red">HALTED</span>
            </>
          ) : (
            <>
              <ShieldCheck className="size-3 text-neon-green" aria-hidden />
              <span className="text-neon-green">gate open</span>
            </>
          )}
        </span>

        <span
          className="flex items-center gap-1 font-terminal text-[10px]"
          title="Regime controller verdict from recent news events: NORMAL, VOLATILE (symbol restrictions active), or CRITICAL_HALT (market-wide stop)"
        >
          <Gauge
            className={cn(
              'size-3',
              risk.regime === 'NORMAL' && 'text-neon-green',
              risk.regime === 'VOLATILE' && 'text-neon-orange',
              risk.regime === 'CRITICAL_HALT' && 'text-neon-red'
            )}
            aria-hidden
          />
          <span
            className={cn(
              risk.regime === 'NORMAL' && 'text-neon-green',
              risk.regime === 'VOLATILE' && 'text-neon-orange',
              risk.regime === 'CRITICAL_HALT' && 'text-neon-red'
            )}
          >
            {risk.regime}
          </span>
        </span>

        <span
          className="ml-auto flex items-center gap-1 font-terminal text-[10px]"
          title="Realized PnL recorded today (risk_state.realized_pnl). Breaching the daily loss limit auto-halts all trade loops."
        >
          <DollarSign className={cn('size-3', pnlUp ? 'text-neon-green' : 'text-neon-red')} aria-hidden />
          <span className={cn('tabular font-semibold', pnlUp ? 'text-neon-green' : 'text-neon-red')}>
            {pnlUp ? '' : '-'}${Math.abs(risk.realizedPnl).toFixed(2)}
          </span>
          <span className="text-muted-foreground/50">realized today</span>
        </span>
      </div>

      {risk.halted && risk.haltReason && (
        <p className="mt-2 rounded bg-neon-red/[0.06] px-2 py-1 font-terminal text-[10px] text-neon-red/80">
          {risk.haltReason}
        </p>
      )}

      {(risk.blockedSymbols.length > 0 || risk.tightenedSymbols.length > 0 || risk.feedDegraded) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 font-terminal text-[10px]">
          {risk.feedDegraded && (
            <span className="flex items-center gap-1 text-neon-orange" title="News feed degraded — the regime controller fails closed while coverage is missing">
              <ShieldOff className="size-3" aria-hidden /> feed degraded
            </span>
          )}
          {risk.blockedSymbols.length > 0 && (
            <span className="text-neon-red/80" title="Symbols blocked by the regime controller — intents for these are rejected">
              blocked: {risk.blockedSymbols.join(' ')}
            </span>
          )}
          {risk.tightenedSymbols.length > 0 && (
            <span className="text-neon-orange/80" title="Symbols with reduced max trade size (regime size multiplier)">
              size-tightened: {risk.tightenedSymbols.join(' ')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

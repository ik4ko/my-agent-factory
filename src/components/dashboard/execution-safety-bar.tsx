'use client';

import { AlertOctagon } from 'lucide-react';
import { useRiskState } from '@/hooks/use-risk-state';
import { useControlStore } from '@/lib/control/control-store';
import { StatusDot } from '@/components/deck';
import { cn } from '@/lib/utils';

/**
 * Execution Safety bar (Trading Room.dc.html §EXECUTION SAFETY).
 *
 * A rack of safety instruments bound to the SAME risk_state row the execution
 * gate enforces (useRiskState) — armed/disarmed, regime, realized P&L, and the
 * halt gate. The KILL SWITCH opens the existing, verified E-Stop confirm modal
 * (useControlStore.openEmergency → emergencyStop server action); it is not a
 * cosmetic toggle.
 *
 * Deviation from the mockup, flagged deliberately: the mockup's Unrealized /
 * Net-Exposure / Current-Drawdown tiles have NO backing column in risk_state,
 * so rather than fabricate figures they are replaced with the real REGIME and
 * GATE instruments. Every number shown here is a real bound value.
 */
export function ExecutionSafetyBar() {
  const { data: risk, isLoading, isError } = useRiskState();
  const openEmergency = useControlStore((s) => s.openEmergency);

  const halted = risk?.halted || risk?.killSwitch;
  const pnlUp = (risk?.realizedPnl ?? 0) >= 0;

  return (
    <div className="flex min-h-[56px] flex-wrap items-stretch rounded-[6px] border border-border/90 bg-[#0e1626]">
      {/* Arm state */}
      <div className="flex items-center gap-3 border-r border-border/60 px-4 py-2">
        <span className="font-mono text-[9px] tracking-[0.2em] text-[#4c6079]">⌐&nbsp;EXECUTION&nbsp;SAFETY</span>
        {isLoading ? (
          <span className="h-5 w-24 animate-pulse rounded bg-surface-2/50" />
        ) : isError || !risk ? (
          <span className="font-mono text-[10px] font-bold tracking-[0.12em] text-destructive" role="alert">
            RISK STATE UNAVAILABLE — TREATING AS UNSAFE
          </span>
        ) : (
          <ArmPill armed={risk.tradingEnabled} halted={Boolean(halted)} />
        )}
        {risk && (
          <div className="flex flex-col gap-[1px]">
            <span className="font-mono text-[8px] tracking-[0.12em] text-ink-low">GATE</span>
            <span className={cn('font-mono text-[10px] tabular', risk.halted ? 'text-destructive' : 'text-neon-green')}>
              {risk.halted ? 'HALTED' : 'open'}
            </span>
          </div>
        )}
      </div>

      {/* Real instruments */}
      {risk && (
        <div className="flex flex-1 flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2">
          <Metric label="REALIZED P&L">
            <span className={cn('tabular text-[16px] font-bold', pnlUp ? 'text-neon-green' : 'text-destructive')}>
              {pnlUp ? '+' : '−'}${Math.abs(risk.realizedPnl).toFixed(2)}
            </span>
          </Metric>

          <Metric label="REGIME">
            <span
              className={cn(
                'tabular text-[13px] font-semibold',
                risk.regime === 'NORMAL' && 'text-neon-green',
                risk.regime === 'VOLATILE' && 'text-warning',
                risk.regime === 'CRITICAL_HALT' && 'text-destructive',
              )}
            >
              {risk.regime}
            </span>
          </Metric>

          {(risk.blockedSymbols.length > 0 || risk.tightenedSymbols.length > 0 || risk.feedDegraded) && (
            <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
              {risk.feedDegraded && <span className="text-warning">feed degraded</span>}
              {risk.blockedSymbols.length > 0 && (
                <span className="text-destructive/85">blocked: {risk.blockedSymbols.join(' ')}</span>
              )}
              {risk.tightenedSymbols.length > 0 && (
                <span className="text-warning/85">tightened: {risk.tightenedSymbols.join(' ')}</span>
              )}
            </div>
          )}

          {risk.halted && risk.haltReason && (
            <span className="tabular text-[10px] text-destructive/80" title={risk.haltReason}>
              {risk.haltReason}
            </span>
          )}
        </div>
      )}

      {/* Kill switch — opens the real E-Stop confirm modal */}
      <button
        type="button"
        onClick={openEmergency}
        title="Kill switch — opens the Emergency Stop confirmation. Halts all active agents & tasks (agent orchestration only; cannot reach a brokerage)."
        aria-label="Kill switch: open emergency stop confirmation to halt all active agents and tasks"
        className={cn(
          'flex items-center gap-[9px] border-l border-border/60 px-5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] transition-[filter]',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-destructive',
          halted
            ? 'bg-destructive/20 text-[#fca5a5] hover:brightness-110'
            : 'bg-destructive/[0.08] text-destructive hover:brightness-125',
        )}
      >
        <AlertOctagon className="size-[14px]" aria-hidden />
        {halted ? 'HALTED — E-STOP' : 'KILL SWITCH'}
      </button>
    </div>
  );
}

function ArmPill({ armed, halted }: { armed: boolean; halted: boolean }) {
  if (halted) {
    return (
      <span className="inline-flex items-center gap-[7px] rounded-[4px] border border-destructive/50 bg-destructive/10 px-[10px] py-[4px]">
        <StatusDot status="error" size={7} />
        <span className="font-mono text-[10px] font-bold tracking-[0.12em] text-destructive">HALTED</span>
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[7px] rounded-[4px] border px-[10px] py-[4px]',
        armed ? 'border-neon-green/40 bg-neon-green/[0.07]' : 'border-ink-low/40 bg-ink-low/[0.06]',
      )}
    >
      <StatusDot status={armed ? 'armed' : 'idle'} size={7} />
      <span
        className={cn(
          'font-mono text-[10px] font-bold tracking-[0.12em]',
          armed ? 'text-neon-green' : 'text-ink-mid',
        )}
      >
        {armed ? 'ARMED' : 'DISARMED · DRY-RUN'}
      </span>
    </span>
  );
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-[1px]">
      <span className="font-mono text-[8px] tracking-[0.14em] text-ink-low">{label}</span>
      {children}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRiskState, RISK_STATE_KEY } from '@/hooks/use-risk-state';
import { PanelChrome, DeckButton, StatusDot, StatusBadge, DataChip } from '@/components/deck';
import { PinActionModal } from './pin-action-modal';
import { WidgetErrorBoundary } from './widget-error-boundary';
import type { PreflightResult } from '@/lib/golive/preflight';
import type { SelftestResult } from '@/lib/golive/selftest';

/**
 * Simulation cockpit — the paper-trading control surface.
 * purge and now living under the four-rooms dashboard layout (nav rail,
 * E-Stop, global chat all inherited).
 *
 * Three instruments, all real:
 *  - PREFLIGHT  → GET  /api/golive/preflight  (read-only checks + caps)
 *  - SELFTEST   → POST /api/golive/selftest   (manual trigger only)
 *  - ARM / KILL → POST /api/control/arm|kill  (PIN-gated via PinActionModal;
 *    the routes verify the operator PIN server-side and enforce the
 *    default-PIN arm lockout — this page adds no new privilege paths)
 */
type PendingAction = { kind: 'arm' | 'disarm' | 'kill-engage' | 'kill-release' } | null;

function useJsonAction<T>(run: () => Promise<Response>) {
  const [data, setData] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fire = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await run();
      if (!res.ok) throw new Error(`${res.status}`);
      setData((await res.json()) as T);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed');
    } finally {
      setBusy(false);
    }
  }, [run]);
  return { data, busy, error, fire };
}

const CHECK_STATUS = { pass: 'profit', warn: 'warning', fail: 'error' } as const;

export function GoLiveClient() {
  const qc = useQueryClient();
  const { data: risk } = useRiskState();
  const [pending, setPending] = useState<PendingAction>(null);

  const preflight = useJsonAction<PreflightResult>(
    useCallback(() => fetch('/api/golive/preflight'), []),
  );
  const selftest = useJsonAction<SelftestResult>(
    useCallback(() => fetch('/api/golive/selftest', { method: 'POST' }), []),
  );

  // Preflight is read-only — run it on entry. Selftest stays manual.
  useEffect(() => {
    void preflight.fire();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirmControl = async (pin: string): Promise<{ ok: boolean; error?: string }> => {
    if (!pending) return { ok: false, error: 'no action' };
    const isArm = pending.kind === 'arm' || pending.kind === 'disarm';
    const res = await fetch(isArm ? '/api/control/arm' : '/api/control/kill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        isArm
          ? { pin, enabled: pending.kind === 'arm', actor: 'golive-cockpit' }
          : { pin, engaged: pending.kind === 'kill-engage', actor: 'golive-cockpit' },
      ),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return { ok: false, error: data.error ?? `failed (${res.status})` };
    await qc.invalidateQueries({ queryKey: RISK_STATE_KEY });
    return { ok: true };
  };

  const MODAL_COPY: Record<NonNullable<PendingAction>['kind'], { title: string; description: string; confirmLabel: string; danger: boolean }> = {
    arm: { title: 'Arm simulation', description: 'Enables paper-order recording within configured caps. No broker connection exists.', confirmLabel: 'ARM SIMULATION', danger: false },
    disarm: { title: 'Disarm simulation', description: 'Pauses paper-order execution.', confirmLabel: 'DISARM', danger: false },
    'kill-engage': { title: 'Engage simulation stop', description: 'Blocks new paper orders and closes legacy submitted rows locally.', confirmLabel: 'ENGAGE STOP', danger: true },
    'kill-release': { title: 'Release kill switch', description: 'New orders become possible again (still gated by arm state and risk caps).', confirmLabel: 'RELEASE', danger: true },
  };

  return (
    <div className="flex flex-col gap-2 p-2">
      {/* ── Arm / kill control strip — real risk_state + PIN-gated actions ── */}
      <PanelChrome
        title="SIMULATION CONTROL"
        accent={risk?.tradingEnabled ? 'gate' : 'default'}
        headerRight={
          risk ? (
            <span className="flex items-center gap-2">
              <StatusBadge status={risk.killSwitch ? 'error' : risk.tradingEnabled ? 'armed' : 'idle'}>
                {risk.killSwitch ? 'STOPPED' : risk.tradingEnabled ? 'SIM ARMED' : 'SIM DISARMED'}
              </StatusBadge>
              {risk.halted && <StatusBadge status="error">HALTED</StatusBadge>}
            </span>
          ) : (
            <span className="font-mono text-[8.5px] text-ink-low">loading…</span>
          )
        }
        bodyClassName="flex flex-wrap items-center gap-2 p-3"
      >
        <DeckButton
          variant={risk?.tradingEnabled ? 'primary' : 'danger'}
          disabled={!risk || (preflight.data ? !preflight.data.canArm && !risk.tradingEnabled : true)}
          onClick={() => setPending({ kind: risk?.tradingEnabled ? 'disarm' : 'arm' })}
        >
          {risk?.tradingEnabled ? 'DISARM' : 'ARM SIMULATION'}
        </DeckButton>
        <DeckButton
          variant={risk?.killSwitch ? 'primary' : 'danger'}
          glyph="⏻"
          disabled={!risk}
          onClick={() => setPending({ kind: risk?.killSwitch ? 'kill-release' : 'kill-engage' })}
        >
          {risk?.killSwitch ? 'RELEASE KILL SWITCH' : 'ENGAGE KILL SWITCH'}
        </DeckButton>
        {preflight.data && !preflight.data.canArm && !risk?.tradingEnabled && (
          <span className="font-mono text-[9.5px] text-warning">arming blocked — preflight is not green</span>
        )}
        <span className="ml-auto font-mono text-[8.5px] text-ink-low">
          PIN verified server-side · arm lockout enforced on default PIN
        </span>
      </PanelChrome>

      <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
        {/* ── Preflight ── */}
        <PanelChrome
          title="PREFLIGHT"
          headerRight={
            <span className="flex items-center gap-2">
              {preflight.data && (
                <StatusBadge status={CHECK_STATUS[preflight.data.overall]}>
                  {preflight.data.overall.toUpperCase()} · {preflight.data.canArm ? 'CAN ARM' : 'CANNOT ARM'}
                </StatusBadge>
              )}
              <DeckButton size="sm" variant="ghost" loading={preflight.busy} onClick={() => void preflight.fire()}>
                RUN
              </DeckButton>
            </span>
          }
          bodyClassName="flex flex-col gap-2 p-3"
        >
          {preflight.error && <p className="font-mono text-[10px] text-destructive">preflight failed: {preflight.error}</p>}
          {!preflight.data && !preflight.error && <div className="h-24 animate-pulse rounded bg-surface-2/40" />}
          {preflight.data && (
            <>
              {preflight.data.checks.map((c) => (
                <div key={c.id} className="flex items-start gap-2 font-mono text-[10px]">
                  <StatusDot status={CHECK_STATUS[c.status]} size={6} className="mt-[3px]" />
                  <span className="w-44 shrink-0 text-ink-hi">{c.label}</span>
                  <span className="min-w-0 text-ink-mid">{c.detail}</span>
                </div>
              ))}
              <div className="mt-1 flex flex-wrap gap-1.5 border-t border-border/50 pt-2">
                <DataChip>max trade ${preflight.data.caps.maxTradeUsd.toLocaleString()}</DataChip>
                <DataChip>daily loss ${preflight.data.caps.dailyLossLimitUsd.toLocaleString()}</DataChip>
                <DataChip>max positions {preflight.data.caps.maxOpenPositions}</DataChip>
                <DataChip>{preflight.data.caps.symbolAllowlist.join(' ') || 'no symbols allowlisted'}</DataChip>
              </div>
            </>
          )}
        </PanelChrome>

        {/* ── Safety selftest — manual trigger only ── */}
        <PanelChrome
          title="SAFETY SELFTEST"
          headerRight={
            <span className="flex items-center gap-2">
              {selftest.data && (
                <StatusBadge status={selftest.data.overall === 'pass' ? 'profit' : 'error'}>
                  {selftest.data.overall.toUpperCase()}
                </StatusBadge>
              )}
              <DeckButton size="sm" variant="primary" loading={selftest.busy} onClick={() => void selftest.fire()}>
                RUN SELFTEST
              </DeckButton>
            </span>
          }
          bodyClassName="flex flex-col gap-2 p-3"
        >
          {selftest.error && <p className="font-mono text-[10px] text-destructive">selftest failed: {selftest.error}</p>}
          {!selftest.data && !selftest.error && (
            <p className="font-mono text-[10px] leading-relaxed text-ink-low">
              Exercises the simulation safety interlocks (kill switch, caps, halt paths) end-to-end. Manual trigger only — it
              writes to the control tables while it runs.
            </p>
          )}
          {selftest.data && (
            <>
              {selftest.data.checks.map((c) => (
                <div key={c.id} className="flex items-start gap-2 font-mono text-[10px]">
                  <StatusDot status={c.status === 'pass' ? 'profit' : 'error'} size={6} className="mt-[3px]" />
                  <span className="w-44 shrink-0 text-ink-hi">{c.label}</span>
                  <span className="min-w-0 text-ink-mid">{c.detail}</span>
                </div>
              ))}
              <span className="mt-1 border-t border-border/50 pt-2 font-mono text-[8.5px] tabular text-ink-low">
                ran {new Date(selftest.data.ranAt).toLocaleTimeString()}
              </span>
            </>
          )}
        </PanelChrome>
      </div>

      {pending && (
        <WidgetErrorBoundary name="PIN Modal">
          <PinActionModal
            title={MODAL_COPY[pending.kind].title}
            description={MODAL_COPY[pending.kind].description}
            confirmLabel={MODAL_COPY[pending.kind].confirmLabel}
            danger={MODAL_COPY[pending.kind].danger}
            onConfirm={confirmControl}
            onClose={() => setPending(null)}
          />
        </WidgetErrorBoundary>
      )}
    </div>
  );
}

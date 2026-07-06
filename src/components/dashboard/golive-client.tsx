'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle, AlertTriangle, Loader2, RefreshCw, ShieldCheck, Skull } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useRiskStateQuery } from '@/hooks/use-risk-state-query';
import { PinActionModal } from '@/components/dashboard/pin-action-modal';
import type { CheckStatus, PreflightResult } from '@/lib/golive/preflight';
import type { SelftestResult } from '@/lib/golive/selftest';

const STATUS_ICON: Record<CheckStatus, typeof CheckCircle2> = { pass: CheckCircle2, warn: AlertTriangle, fail: XCircle };
const STATUS_COLOR: Record<CheckStatus, string> = { pass: 'text-neon-green', warn: 'text-warning', fail: 'text-neon-red' };
const STATUS_BADGE: Record<CheckStatus, 'success' | 'warning' | 'error'> = { pass: 'success', warn: 'warning', fail: 'error' };

async function controlPost(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: json?.error ?? `request failed (${res.status})` };
  return { ok: true };
}

function usePreflight() {
  return useQuery<PreflightResult>({
    queryKey: ['golive-preflight'],
    queryFn: async () => {
      const res = await fetch('/api/golive/preflight');
      if (!res.ok) throw new Error(`preflight fetch failed (${res.status})`);
      return res.json();
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

function ArmConfirmModal({ caps, onClose }: { caps: PreflightResult['caps']; onClose: () => void }) {
  const [pin, setPin] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!pin || !understood) return;
    setPending(true);
    setError(null);
    const result = await controlPost('/api/control/arm', { pin, enabled: true });
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? 'rejected');
      return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-xl border border-neon-red/40 bg-surface-1 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-neon-red/20 px-4 py-3 text-neon-red">
          <ShieldCheck className="size-4" />
          <span className="font-terminal text-xs font-bold uppercase tracking-[0.2em]">Go live</span>
        </div>
        <div className="space-y-3 px-4 py-4">
          <label className="flex items-start gap-2 text-xs leading-relaxed text-foreground/90">
            <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="mt-0.5 size-5 shrink-0" />
            <span>
              I understand this trades <strong>real money</strong> within these caps: max ${caps.maxTradeUsd}/trade, ${caps.dailyLossLimitUsd} daily
              loss limit (auto-halts), {caps.maxOpenPositions} max open positions, symbols: {caps.symbolAllowlist.join(', ') || 'none configured'}.
              No per-trade approval happens after this.
            </span>
          </label>
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Operator PIN"
            className="h-11 w-full rounded-md border border-border bg-background px-3 text-center text-lg tracking-[0.3em]"
          />
          {error && <p className="rounded border border-neon-red/30 bg-neon-red/10 px-2 py-1.5 font-terminal text-[10px] text-neon-red">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button onClick={onClose} disabled={pending} className="flex min-h-11 items-center rounded-md border border-border px-3 font-terminal text-[10px] text-muted-foreground">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={pending || !pin || !understood}
            className="flex min-h-11 items-center gap-1.5 rounded-md border border-neon-red/50 bg-neon-red/15 px-3 font-terminal text-[10px] font-bold uppercase tracking-wider text-neon-red disabled:opacity-40"
          >
            {pending && <Loader2 className="size-3 animate-spin" />}
            Arm live
          </button>
        </div>
      </div>
    </div>
  );
}

export function GoLiveClient() {
  const { data: preflight, refetch: refetchPreflight, isFetching } = usePreflight();
  const { data: risk } = useRiskStateQuery();
  const queryClient = useQueryClient();
  const [selftest, setSelftest] = useState<SelftestResult | null>(null);
  const [selftestRunning, setSelftestRunning] = useState(false);
  const [modal, setModal] = useState<'arm' | 'kill' | null>(null);

  const canArm = Boolean(preflight?.canArm) && !risk?.trading_enabled;

  async function runSelftest() {
    setSelftestRunning(true);
    try {
      const res = await fetch('/api/golive/selftest', { method: 'POST' });
      setSelftest(await res.json());
      await queryClient.invalidateQueries({ queryKey: ['risk-state'] });
    } finally {
      setSelftestRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={risk?.trading_enabled ? 'success' : 'muted'}>{risk?.trading_enabled ? 'ARMED' : 'disarmed'}</Badge>
        <Badge variant={risk?.kill_switch ? 'error' : 'muted'}>{risk?.kill_switch ? 'KILL ENGAGED' : 'kill clear'}</Badge>
        {risk && <Badge variant={risk.regime === 'NORMAL' ? 'success' : risk.regime === 'VOLATILE' ? 'warning' : 'error'}>{risk.regime}</Badge>}
        {risk?.feed_degraded && <Badge variant="error">feed degraded</Badge>}
      </div>

      <section className="rounded-lg border border-border p-3">
        <div className="flex items-center justify-between">
          <h2 className="font-terminal text-[10px] uppercase tracking-widest text-muted-foreground">
            Preflight {preflight && <Badge variant={STATUS_BADGE[preflight.overall]} className="ml-1">{preflight.overall}</Badge>}
          </h2>
          <Button variant="ghost" size="icon-sm" onClick={() => refetchPreflight()} disabled={isFetching}>
            <RefreshCw className={cn(isFetching && 'animate-spin')} />
          </Button>
        </div>
        <div className="mt-2 flex flex-col gap-1.5">
          {preflight?.checks.map((c) => {
            const Icon = STATUS_ICON[c.status];
            return (
              <div key={c.id} className="flex items-start gap-2 text-xs">
                <Icon className={cn('mt-0.5 size-3.5 shrink-0', STATUS_COLOR[c.status])} />
                <div>
                  <div className="font-medium text-foreground">{c.label}</div>
                  <div className="text-[11px] text-muted-foreground">{c.detail}</div>
                </div>
              </div>
            );
          })}
          {!preflight && <p className="text-xs text-muted-foreground">Loading…</p>}
        </div>
      </section>

      {preflight && (
        <section className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
          Effective caps: max ${preflight.caps.maxTradeUsd}/trade · ${preflight.caps.dailyLossLimitUsd} daily loss limit ·{' '}
          {preflight.caps.maxOpenPositions} max positions · symbols: {preflight.caps.symbolAllowlist.join(', ') || 'none'}
        </section>
      )}

      <section className="rounded-lg border border-border p-3">
        <div className="flex items-center justify-between">
          <h2 className="font-terminal text-[10px] uppercase tracking-widest text-muted-foreground">
            Safety self-test {selftest && <Badge variant={selftest.overall === 'pass' ? 'success' : 'error'} className="ml-1">{selftest.overall}</Badge>}
          </h2>
          <Button variant="outline" size="sm" onClick={runSelftest} disabled={selftestRunning}>
            {selftestRunning ? <Loader2 className="animate-spin" /> : null} Run selftest
          </Button>
        </div>
        <div className="mt-2 flex flex-col gap-1.5">
          {!selftest && <p className="text-xs text-muted-foreground">Not run yet this session.</p>}
          {selftest?.checks.map((c) => {
            const Icon = c.status === 'pass' ? CheckCircle2 : XCircle;
            return (
              <div key={c.id} className="flex items-start gap-2 text-xs">
                <Icon className={cn('mt-0.5 size-3.5 shrink-0', c.status === 'pass' ? 'text-neon-green' : 'text-neon-red')} />
                <div>
                  <div className="font-medium text-foreground">{c.label}</div>
                  <div className="text-[11px] text-muted-foreground">{c.detail}</div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="sticky bottom-0 mt-2 flex gap-2 rounded-lg border border-border bg-surface-1 p-2">
        <button
          onClick={() => canArm && setModal('arm')}
          disabled={!canArm}
          title={canArm ? 'Arm live trading' : 'Preflight must be green (and not already armed) to arm'}
          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border border-primary/40 bg-primary/10 font-terminal text-xs font-bold uppercase tracking-wider text-primary disabled:opacity-30"
        >
          Arm live
        </button>
        <button
          onClick={() => setModal('kill')}
          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border border-neon-red/50 bg-neon-red/15 font-terminal text-xs font-bold uppercase tracking-wider text-neon-red"
        >
          <Skull className="size-4" /> Kill
        </button>
      </div>

      {modal === 'arm' && preflight && <ArmConfirmModal caps={preflight.caps} onClose={() => setModal(null)} />}
      {modal === 'kill' && (
        <PinActionModal
          title="Kill switch"
          description="Cancels every open order and blocks all new orders until released."
          confirmLabel="Engage kill switch"
          danger
          onClose={() => setModal(null)}
          onConfirm={(pin) => controlPost('/api/control/kill', { pin, engaged: true })}
        />
      )}
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BellRing, Link2, Loader2, Radio, RefreshCw, ShieldCheck, Target, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OptionsFlowThresholds {
  minContracts: number;
  minPremiumUsd: number;
  symbols: string[];
  provider: string;
  configured: boolean;
  notify: boolean;
  maxAgeMinutes: number;
  maxAlertsPerScan: number;
}

interface OptionsFlowAlert {
  id?: string;
  source: string;
  underlying: string;
  contractSymbol: string;
  contracts: number;
  premiumUsd: number;
  averagePrice: number | null;
  tradeType: string | null;
  sideHint: string | null;
  timestamp: string;
  expiration: string | null;
  strike: number | null;
  optionType: 'CALL' | 'PUT' | null;
  dte: number | null;
  severity: 'low' | 'med' | 'high' | 'critical';
  reason: string;
  score: number;
  labels: string[];
  action: 'watch' | 'review' | 'urgent_review';
  validatorBrief: string;
  createdAt?: string;
}

interface OptionsFlowResponse {
  thresholds?: OptionsFlowThresholds;
  alerts?: OptionsFlowAlert[];
  error?: string;
}

interface StrategyConfig {
  strategyType?: string;
  symbolAllowlist?: string[];
}

interface StrategyLoop {
  id: string;
  name: string;
  objective: string;
  status: 'armed' | 'paused' | 'stopped';
  config?: StrategyConfig | null;
}

function money(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1000) return `$${Math.round(value / 1000)}K`;
  return `$${Math.round(value)}`;
}

function relativeTime(value: string | undefined): string {
  if (!value) return 'now';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return 'now';
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

async function fetchOptionsFlow(): Promise<OptionsFlowResponse> {
  const res = await fetch('/api/trading/options-flow?limit=20', { cache: 'no-store' });
  const data = (await res.json().catch(() => ({}))) as OptionsFlowResponse;
  if (!res.ok) throw new Error(data.error ?? 'options flow unavailable');
  return data;
}

async function fetchStrategies(): Promise<StrategyLoop[]> {
  const res = await fetch('/api/trading/strategies', { cache: 'no-store' });
  const data = (await res.json().catch(() => ({}))) as { strategies?: StrategyLoop[] };
  if (!res.ok) return [];
  return Array.isArray(data.strategies) ? data.strategies : [];
}

function timestampMs(alert: OptionsFlowAlert): number {
  const value = Date.parse(alert.createdAt ?? alert.timestamp);
  return Number.isFinite(value) ? value : 0;
}

function actionCopy(action: OptionsFlowAlert['action']): string {
  if (action === 'urgent_review') return 'urgent review';
  if (action === 'review') return 'review';
  return 'watch';
}

function signalSummary(alert: OptionsFlowAlert, thresholds: OptionsFlowThresholds | null): string {
  const contractRatio = thresholds?.minContracts ? alert.contracts / thresholds.minContracts : null;
  const premiumRatio = thresholds?.minPremiumUsd ? alert.premiumUsd / thresholds.minPremiumUsd : null;
  const ratios = [
    contractRatio !== null ? `${contractRatio.toFixed(1)}x contract floor` : null,
    premiumRatio !== null ? `${premiumRatio.toFixed(1)}x premium floor` : null,
  ].filter(Boolean);
  const option = [alert.optionType, alert.expiration, alert.strike ? `$${alert.strike}` : null, alert.dte !== null ? `${alert.dte}DTE` : null]
    .filter(Boolean)
    .join(' · ');
  const side = alert.sideHint ? ` · ${alert.sideHint.replace(/_/g, ' ')}` : '';
  return `${money(alert.premiumUsd)} across ${alert.contracts.toLocaleString()} contracts${option ? ` · ${option}` : ''}${side}${ratios.length ? ` · ${ratios.join(' / ')}` : ''}`;
}

function linkedStrategiesFor(alert: OptionsFlowAlert, strategies: StrategyLoop[]): StrategyLoop[] {
  const underlying = alert.underlying.toUpperCase();
  return strategies
    .filter((strategy) => {
      const symbols = (strategy.config?.symbolAllowlist ?? []).map((symbol) => symbol.toUpperCase());
      return symbols.length === 0 || symbols.includes(underlying);
    })
    .sort((a, b) => {
      const rank = { armed: 0, paused: 1, stopped: 2 };
      return rank[a.status] - rank[b.status];
    })
    .slice(0, 3);
}

export function OptionsFlowPanel({
  selectedSymbol,
  onSelectSymbol,
}: {
  selectedSymbol?: string;
  onSelectSymbol?: (symbol: string) => void;
} = {}) {
  const [thresholds, setThresholds] = useState<OptionsFlowThresholds | null>(null);
  const [alerts, setAlerts] = useState<OptionsFlowAlert[]>([]);
  const [strategies, setStrategies] = useState<StrategyLoop[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setError(null);
      const [data, nextStrategies] = await Promise.all([fetchOptionsFlow(), fetchStrategies().catch(() => [])]);
      setThresholds(data.thresholds ?? null);
      setAlerts(Array.isArray(data.alerts) ? data.alerts : []);
      setStrategies(nextStrategies);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'options flow unavailable');
    }
  };

  useEffect(() => {
    // Data fetch on mount. The loader is async and sets state around an await;
    // this is React's documented pattern for loading data in a client component,
    // not derived state feeding a cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const interval = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(interval);
  }, []);

  const runScan = async (action: 'scan' | 'simulate') => {
    setBusy(true);
    setReply(null);
    try {
      const res = await fetch('/api/trading/options-flow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json().catch(() => ({}))) as { inserted?: number; candidates?: number; scanned?: number; reason?: string; error?: string };
      setReply(data.error ?? data.reason ?? `scan: ${data.scanned ?? 0} trades · ${data.candidates ?? 0} signals · ${data.inserted ?? 0} new`);
      await refresh();
    } catch (err) {
      setReply(err instanceof Error ? err.message : 'options scan failed');
    } finally {
      setBusy(false);
    }
  };

  const status = useMemo(() => {
    if (!thresholds) return { label: 'loading', tone: 'muted' as const };
    if (!thresholds.configured) return { label: 'provider off', tone: 'warn' as const };
    return { label: thresholds.provider, tone: 'ok' as const };
  }, [thresholds]);

  const rankedAlerts = useMemo(
    () => [...alerts].sort((a, b) => b.score - a.score || b.premiumUsd - a.premiumUsd || timestampMs(b) - timestampMs(a)),
    [alerts],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <BellRing className="size-3.5 text-warning" aria-hidden />
        <span className="font-terminal text-[10px] uppercase tracking-widest text-muted-foreground">Options flow</span>
        <span
          className={cn(
            'ml-auto rounded border px-1.5 py-px font-terminal text-[8.5px] uppercase tracking-wider',
            status.tone === 'ok' ? 'border-neon-green/35 text-neon-green' : status.tone === 'warn' ? 'border-warning/35 text-warning' : 'border-border text-muted-foreground',
          )}
        >
          {status.label}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {error && (
          <p className="mb-2 rounded border border-neon-red/35 bg-neon-red/[0.05] p-2 font-terminal text-[10px] text-neon-red/85">
            {error}
          </p>
        )}

        <div className="mb-2 grid grid-cols-2 gap-1.5 font-terminal text-[8.5px] uppercase tracking-wider">
          <div className="rounded border border-border/55 bg-surface-1/45 p-1.5">
            <p className="text-muted-foreground/45">contracts</p>
            <p className="mt-0.5 text-foreground">{thresholds?.minContracts.toLocaleString() ?? '—'}+</p>
          </div>
          <div className="rounded border border-border/55 bg-surface-1/45 p-1.5">
            <p className="text-muted-foreground/45">premium</p>
            <p className="mt-0.5 text-foreground">{thresholds ? money(thresholds.minPremiumUsd) : '—'}+</p>
          </div>
          <div className="rounded border border-border/55 bg-surface-1/45 p-1.5">
            <p className="text-muted-foreground/45">freshness</p>
            <p className="mt-0.5 text-foreground">{thresholds?.maxAgeMinutes ?? '—'}m</p>
          </div>
          <div className="rounded border border-border/55 bg-surface-1/45 p-1.5">
            <p className="text-muted-foreground/45">max scan</p>
            <p className="mt-0.5 text-foreground">{thresholds?.maxAlertsPerScan ?? '—'} alerts</p>
          </div>
        </div>

        <div className="mb-2 flex gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => void runScan('scan')}
            className="flex flex-1 items-center justify-center gap-1 rounded border border-primary/35 bg-primary/10 px-2 py-1.5 font-terminal text-[8.5px] uppercase tracking-wider text-primary hover:bg-primary/15 disabled:cursor-wait disabled:opacity-55"
          >
            {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <RefreshCw className="size-3" aria-hidden />}
            scan
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runScan('simulate')}
            className="flex items-center justify-center gap-1 rounded border border-warning/35 bg-warning/10 px-2 py-1.5 font-terminal text-[8.5px] uppercase tracking-wider text-warning hover:bg-warning/15 disabled:cursor-wait disabled:opacity-55"
            title="Insert one local test alert so the live feed and notifications can be verified without a data vendor."
          >
            <Zap className="size-3" aria-hidden />
            test
          </button>
        </div>

        {reply && <p className="mb-2 rounded border border-border/60 bg-background/55 p-1.5 text-[10px] text-muted-foreground/70">{reply}</p>}

        {!thresholds?.configured && (
          <p className="mb-2 rounded border border-warning/25 bg-warning/[0.04] p-2 text-[10px] leading-relaxed text-warning/80">
            Configure an options data provider to scan live flow. Today this supports Intrinio unusual activity or local test signals.
          </p>
        )}

        {rankedAlerts.length === 0 ? (
          <p className="py-5 text-center font-terminal text-[10px] leading-relaxed text-muted-foreground/45">
            No option-flow alerts yet. Signals appear here when contract count or premium crosses your threshold.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded border border-border/50 bg-surface-1/35 px-2 py-1.5 font-terminal text-[8.5px] uppercase tracking-wider text-muted-foreground/55">
              <Target className="size-3 text-primary" aria-hidden />
              Ranked by score, premium, then recency
            </div>
            {rankedAlerts.map((alert, index) => {
              const critical = alert.severity === 'critical';
              const linkedStrategies = linkedStrategiesFor(alert, strategies);
              const selectable = Boolean(onSelectSymbol);
              const onChart = Boolean(selectedSymbol && alert.underlying.toUpperCase() === selectedSymbol.toUpperCase());
              return (
                <div
                  key={alert.id ?? `${alert.contractSymbol}:${alert.timestamp}`}
                  role={selectable ? 'button' : undefined}
                  tabIndex={selectable ? 0 : undefined}
                  onClick={selectable ? () => onSelectSymbol?.(alert.underlying) : undefined}
                  onKeyDown={
                    selectable
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSelectSymbol?.(alert.underlying);
                          }
                        }
                      : undefined
                  }
                  title={selectable ? `Chart ${alert.underlying}` : undefined}
                  className={cn(
                    'rounded-md border px-2.5 py-2.5 transition-colors',
                    selectable && 'cursor-pointer hover:border-primary/45',
                    critical ? 'border-neon-red/35 bg-neon-red/[0.055]' : 'border-warning/25 bg-warning/[0.04]',
                    onChart && 'ring-1 ring-primary/55',
                  )}
                >
                  <div className="mb-1.5 flex items-center gap-1.5 font-terminal text-[9px] uppercase tracking-wider">
                    <span className="rounded border border-border/60 bg-background/50 px-1 py-px text-muted-foreground/60">#{index + 1}</span>
                    {critical ? <AlertTriangle className="size-3 text-neon-red" aria-hidden /> : <Radio className="size-3 text-warning" aria-hidden />}
                    <span className={critical ? 'text-neon-red' : 'text-warning'}>{alert.underlying}</span>
                    {alert.optionType && <span className="text-muted-foreground/45">{alert.optionType}</span>}
                    {alert.dte !== null && <span className="text-muted-foreground/45">{alert.dte}DTE</span>}
                    <span className={cn('rounded border px-1 py-px', alert.score >= 80 ? 'border-neon-red/40 text-neon-red' : 'border-warning/35 text-warning')}>
                      {alert.score}/100
                    </span>
                    <span className="rounded border border-primary/25 px-1 py-px text-primary/75">{actionCopy(alert.action)}</span>
                    {onChart && <span className="rounded border border-primary/55 bg-primary/10 px-1 py-px text-primary">on chart</span>}
                    <span className="ml-auto text-muted-foreground/35">{relativeTime(alert.createdAt ?? alert.timestamp)} ago</span>
                  </div>
                  <p className="truncate font-terminal text-[9px] uppercase tracking-wider text-muted-foreground/45">{alert.contractSymbol}</p>

                  <div className="mt-2 rounded border border-border/55 bg-background/45 p-2">
                    <p className="mb-1 font-terminal text-[8.5px] uppercase tracking-wider text-primary/70">Why this matters</p>
                    <p className="text-[10.5px] leading-relaxed text-foreground/82">{signalSummary(alert, thresholds)}</p>
                    <p className="mt-1 line-clamp-2 text-[9.5px] leading-relaxed text-muted-foreground/55">{alert.reason}</p>
                  </div>

                  <div className="mt-2 rounded border border-warning/20 bg-warning/[0.025] p-2">
                    <p className="mb-1 flex items-center gap-1 font-terminal text-[8.5px] uppercase tracking-wider text-warning/75">
                      <ShieldCheck className="size-3" aria-hidden /> reject-first validator
                    </p>
                    <p className="line-clamp-3 text-[9.5px] leading-relaxed text-muted-foreground/68">{alert.validatorBrief}</p>
                  </div>

                  <div className="mt-2 rounded border border-primary/15 bg-primary/[0.025] p-2">
                    <p className="mb-1 flex items-center gap-1 font-terminal text-[8.5px] uppercase tracking-wider text-primary/75">
                      <Link2 className="size-3" aria-hidden /> linked strategy
                    </p>
                    {linkedStrategies.length > 0 ? (
                      <div className="space-y-1">
                        {linkedStrategies.map((strategy) => (
                          <div key={strategy.id} className="flex items-center gap-1.5 font-terminal text-[8.5px] uppercase tracking-wider">
                            <span
                              className={cn(
                                'rounded border px-1.5 py-px',
                                strategy.status === 'armed'
                                  ? 'border-neon-green/35 text-neon-green'
                                  : strategy.status === 'paused'
                                    ? 'border-warning/35 text-warning'
                                    : 'border-border text-muted-foreground/55',
                              )}
                            >
                              {strategy.status}
                            </span>
                            <span className="truncate text-muted-foreground/75">{strategy.name}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[9.5px] leading-relaxed text-muted-foreground/50">
                        No saved strategy is pinned to {alert.underlying} yet. Add one in Room Strategies to turn this signal into a mandate input.
                      </p>
                    )}
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1 font-terminal text-[8.5px] uppercase tracking-wider">
                    <span className="rounded border border-border/60 px-1.5 py-px text-muted-foreground/65">
                      {alert.contracts.toLocaleString()} contracts
                    </span>
                    <span className="rounded border border-border/60 px-1.5 py-px text-muted-foreground/65">{money(alert.premiumUsd)}</span>
                    <span className="rounded border border-border/60 px-1.5 py-px text-muted-foreground/50">{alert.source}</span>
                    {alert.labels.slice(0, 5).map((label) => (
                      <span key={label} className="rounded border border-primary/25 px-1.5 py-px text-primary/70">
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border px-3 py-2 font-terminal text-[8.5px] text-muted-foreground/45">
        Watching {(thresholds?.symbols ?? []).join(', ') || 'no symbols'} · scanner is deterministic, Claude reviews only filtered signals.
      </div>
    </div>
  );
}

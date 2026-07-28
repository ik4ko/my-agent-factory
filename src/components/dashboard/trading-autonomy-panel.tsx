'use client';

import { useEffect, useState } from 'react';
import { Bot, Loader2, Pause, Play, Plus, Radio, ShieldAlert, Trash2, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MandateSummary {
  id: string;
  name: string;
  objective: string;
  status: string;
  brain: string;
  updated_at: string;
}

interface OrderSummary {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  status: string;
  qty: number | null;
  notional: number | null;
  fill_price: number | null;
  reason: string | null;
  created_at: string;
}

interface StrategyConfig {
  autonomousMandate?: boolean;
  strategyType?: string;
  timeframe?: string;
  symbolAllowlist?: string[];
  maxTradeUsd?: number;
  maxOpenPositions?: number;
  confidenceThreshold?: number;
  notes?: string;
}

interface StrategyLoop {
  id: string;
  name: string;
  objective: string;
  status: 'armed' | 'paused' | 'stopped';
  cadence_seconds: number | null;
  config: StrategyConfig;
  brain: string;
  updated_at: string;
}

interface TradingAutonomyStatus {
  tradingEnabled: boolean;
  halted: boolean;
  killSwitch: boolean;
  haltReason: string | null;
  regime: string;
  activeMandates: MandateSummary[];
  recentOrders: OrderSummary[];
  caps: {
    symbolAllowlist: string[];
    maxTradeUsd: number;
    dailyLossLimitUsd: number;
    maxOpenPositions: number;
    maxOrdersPerHour: number;
  };
}

async function fetchStatus(): Promise<TradingAutonomyStatus> {
  const res = await fetch('/api/trading/autonomy', { cache: 'no-store' });
  const data = (await res.json().catch(() => ({}))) as TradingAutonomyStatus & { error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Trading autonomy unavailable');
  return data;
}

async function fetchStrategies(): Promise<StrategyLoop[]> {
  const res = await fetch('/api/trading/strategies', { cache: 'no-store' });
  const data = (await res.json().catch(() => ({}))) as { strategies?: StrategyLoop[]; error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Trading strategies unavailable');
  return Array.isArray(data.strategies) ? data.strategies : [];
}

const STRATEGY_OPTIONS = [
  { value: 'follow_the_money', label: 'Follow the money' },
  { value: 'momentum', label: 'Momentum' },
  { value: 'breakout', label: 'Breakout' },
  { value: 'mean_reversion', label: 'Mean reversion' },
  { value: 'news_catalyst', label: 'News catalyst' },
  { value: 'custom', label: 'Custom' },
] as const;

export function TradingAutonomyPanel() {
  const [status, setStatus] = useState<TradingAutonomyStatus | null>(null);
  const [strategies, setStrategies] = useState<StrategyLoop[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [strategyBusy, setStrategyBusy] = useState<string | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [symbols, setSymbols] = useState('');
  const [strategyType, setStrategyType] = useState<(typeof STRATEGY_OPTIONS)[number]['value']>('follow_the_money');
  const [maxTradeUsd, setMaxTradeUsd] = useState(250);
  const [confidenceThreshold, setConfidenceThreshold] = useState(65);
  const [objective, setObjective] = useState(
    'Find a high-quality setup using price action, volume, market regime, news/catalysts, and risk/reward. Trade only when evidence is strong and opposing evidence is addressed.',
  );

  const refresh = async () => {
    try {
      setError(null);
      const [nextStatus, nextStrategies] = await Promise.all([fetchStatus(), fetchStrategies()]);
      setStatus(nextStatus);
      setStrategies(nextStrategies);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Trading autonomy unavailable');
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

  const pulse = async () => {
    setBusy(true);
    setReply(null);
    try {
      const res = await fetch('/api/trading/autonomy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ action: 'pulse', reason: 'manual Trading Room autonomy pulse' }),
      });
      const data = (await res.json().catch(() => ({}))) as { reply?: string; error?: string };
      setReply(data.reply ?? data.error ?? 'Pulse sent.');
      await refresh();
    } catch (err) {
      setReply(err instanceof Error ? err.message : 'Pulse failed.');
    } finally {
      setBusy(false);
    }
  };

  const createStrategy = async () => {
    if (!name.trim() || !objective.trim()) return;
    setStrategyBusy('create');
    try {
      const res = await fetch('/api/trading/strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          objective,
          strategyType,
          symbols,
          maxTradeUsd,
          confidenceThreshold: confidenceThreshold / 100,
          status: 'paused',
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'strategy create failed');
      setName('');
      setSymbols('');
      setFormOpen(false);
      setReply('Strategy saved paused. Arm it once when you want Claude to run it autonomously inside caps.');
      await refresh();
    } catch (err) {
      setReply(err instanceof Error ? err.message : 'strategy create failed');
    } finally {
      setStrategyBusy(null);
    }
  };

  const patchStrategy = async (id: string, status: StrategyLoop['status']) => {
    setStrategyBusy(id);
    try {
      const res = await fetch(`/api/trading/strategies/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'strategy update failed');
      await refresh();
    } catch (err) {
      setReply(err instanceof Error ? err.message : 'strategy update failed');
    } finally {
      setStrategyBusy(null);
    }
  };

  const deleteStrategy = async (strategy: StrategyLoop) => {
    if (!confirm(`Delete strategy "${strategy.name}"?`)) return;
    setStrategyBusy(strategy.id);
    try {
      const res = await fetch(`/api/trading/strategies/${strategy.id}`, { method: 'DELETE' });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'strategy delete failed');
      await refresh();
    } catch (err) {
      setReply(err instanceof Error ? err.message : 'strategy delete failed');
    } finally {
      setStrategyBusy(null);
    }
  };

  const live = Boolean(status?.tradingEnabled) && !status?.halted && !status?.killSwitch;
  const blocked = Boolean(status?.halted || status?.killSwitch);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Bot className="size-3.5 text-primary" aria-hidden />
        <span className="font-terminal text-[10px] uppercase tracking-widest text-muted-foreground">Agentic mandate</span>
        <span
          className={cn(
            'ml-auto rounded border px-1.5 py-px font-terminal text-[8.5px] uppercase tracking-wider',
            blocked
              ? 'border-neon-red/40 text-neon-red'
              : live
                ? 'border-neon-green/40 text-neon-green'
                : 'border-warning/40 text-warning',
          )}
        >
          {blocked ? 'blocked' : live ? 'live' : 'dry-run'}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {error ? (
          <p className="rounded border border-neon-red/30 bg-neon-red/[0.05] p-2 font-terminal text-[10px] text-neon-red/80">
            {error}
          </p>
        ) : !status ? (
          <p className="flex items-center gap-2 font-terminal text-[10px] text-muted-foreground/50">
            <Loader2 className="size-3 animate-spin" aria-hidden /> loading mandate...
          </p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 font-terminal text-[9px]">
              <div className="rounded border border-border/60 bg-surface-1/50 p-2">
                <p className="text-muted-foreground/50">REGIME</p>
                <p className="mt-1 text-foreground">{status.regime}</p>
              </div>
              <div className="rounded border border-border/60 bg-surface-1/50 p-2">
                <p className="text-muted-foreground/50">MANDATES</p>
                <p className="mt-1 text-foreground">{status.activeMandates.length} armed</p>
              </div>
              <div className="rounded border border-border/60 bg-surface-1/50 p-2">
                <p className="text-muted-foreground/50">MAX TRADE</p>
                <p className="mt-1 text-foreground">${status.caps.maxTradeUsd}</p>
              </div>
              <div className="rounded border border-border/60 bg-surface-1/50 p-2">
                <p className="text-muted-foreground/50">DAILY LOSS</p>
                <p className="mt-1 text-foreground">${status.caps.dailyLossLimitUsd}</p>
              </div>
            </div>

            {blocked && (
              <div className="flex gap-2 rounded border border-neon-red/30 bg-neon-red/[0.05] p-2 text-[10px] text-neon-red/85">
                <ShieldAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                <span>{status.killSwitch ? 'Kill switch engaged.' : status.haltReason ?? 'Trading halted.'}</span>
              </div>
            )}

            <div className="rounded border border-border/60 bg-surface-1/40 p-2">
              <p className="mb-1.5 flex items-center gap-1.5 font-terminal text-[9px] uppercase tracking-wider text-muted-foreground/55">
                <Radio className="size-3" aria-hidden /> Active mandates
              </p>
              {status.activeMandates.length === 0 ? (
                <p className="font-terminal text-[10px] leading-relaxed text-muted-foreground/45">
                  No armed mandate. “Go make a trade” will create/find the default mandate, but it will not trade until you arm the mandate once.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {status.activeMandates.map((mandate) => (
                    <div key={mandate.id} className="rounded border border-primary/20 bg-primary/[0.04] p-2">
                      <p className="font-terminal text-[10px] text-primary">{mandate.name}</p>
                      <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground/65">{mandate.objective}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded border border-border/60 bg-surface-1/40 p-2">
              <div className="mb-2 flex items-center gap-2">
                <p className="font-terminal text-[9px] uppercase tracking-wider text-muted-foreground/55">Room strategies</p>
                <button
                  type="button"
                  onClick={() => setFormOpen((v) => !v)}
                  className="ml-auto flex items-center gap-1 rounded border border-primary/30 px-1.5 py-px font-terminal text-[8.5px] uppercase tracking-wider text-primary hover:bg-primary/10"
                >
                  <Plus className="size-2.5" aria-hidden /> add
                </button>
              </div>

              {formOpen && (
                <div className="mb-2 space-y-2 rounded border border-primary/20 bg-background/50 p-2">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Strategy name, e.g. Follow the Money Breakout"
                    className="w-full rounded border border-border bg-background px-2 py-1.5 font-terminal text-[10px] text-foreground outline-none focus:border-primary/50"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={strategyType}
                      onChange={(e) => setStrategyType(e.target.value as typeof strategyType)}
                      className="rounded border border-border bg-background px-2 py-1.5 font-terminal text-[10px] text-foreground outline-none"
                    >
                      {STRATEGY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <input
                      value={symbols}
                      onChange={(e) => setSymbols(e.target.value.toUpperCase())}
                      placeholder="Symbols: NVDA,QQQ"
                      className="rounded border border-border bg-background px-2 py-1.5 font-terminal text-[10px] text-foreground outline-none focus:border-primary/50"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="font-terminal text-[9px] text-muted-foreground/60">
                      Max $
                      <input
                        type="number"
                        min={1}
                        value={maxTradeUsd}
                        onChange={(e) => setMaxTradeUsd(Number(e.target.value))}
                        className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-[10px] text-foreground outline-none"
                      />
                    </label>
                    <label className="font-terminal text-[9px] text-muted-foreground/60">
                      Confidence %
                      <input
                        type="number"
                        min={50}
                        max={95}
                        value={confidenceThreshold}
                        onChange={(e) => setConfidenceThreshold(Number(e.target.value))}
                        className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-[10px] text-foreground outline-none"
                      />
                    </label>
                  </div>
                  <textarea
                    value={objective}
                    onChange={(e) => setObjective(e.target.value)}
                    rows={4}
                    placeholder="Describe the strategy rules, setup, evidence, invalidation, and what would make Claude hold."
                    className="w-full resize-none rounded border border-border bg-background px-2 py-1.5 font-terminal text-[10px] text-foreground outline-none focus:border-primary/50"
                  />
                  <button
                    type="button"
                    onClick={() => void createStrategy()}
                    disabled={strategyBusy === 'create' || !name.trim() || objective.trim().length < 20}
                    className="w-full rounded border border-primary/35 bg-primary/10 px-2 py-1.5 font-terminal text-[9px] uppercase tracking-wider text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {strategyBusy === 'create' ? 'Saving...' : 'Save paused strategy'}
                  </button>
                </div>
              )}

              {strategies.length === 0 ? (
                <p className="font-terminal text-[10px] leading-relaxed text-muted-foreground/45">
                  No strategies yet. Add your first reusable setup, then arm it once when you want Claude to run it.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {strategies.slice(0, 5).map((strategy) => {
                    const cfg = strategy.config ?? {};
                    const armed = strategy.status === 'armed';
                    return (
                      <div key={strategy.id} className={cn('rounded border p-2', armed ? 'border-neon-green/30 bg-neon-green/[0.04]' : 'border-border/55 bg-background/45')}>
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-terminal text-[10px] text-foreground">{strategy.name}</p>
                            <p className="mt-0.5 line-clamp-2 text-[9.5px] leading-relaxed text-muted-foreground/60">{strategy.objective}</p>
                            <p className="mt-1 font-terminal text-[8.5px] uppercase tracking-wider text-muted-foreground/45">
                              {cfg.strategyType ?? 'custom'} · {cfg.symbolAllowlist?.join(', ') || 'global watchlist'} · ${cfg.maxTradeUsd ?? 'cap'}
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-1">
                            {armed ? (
                              <button
                                type="button"
                                title="Pause strategy"
                                disabled={strategyBusy === strategy.id}
                                onClick={() => void patchStrategy(strategy.id, 'paused')}
                                className="rounded border border-border px-1.5 py-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
                              >
                                <Pause className="size-3" aria-hidden />
                              </button>
                            ) : (
                              <button
                                type="button"
                                title="Arm strategy"
                                disabled={strategyBusy === strategy.id}
                                onClick={() => void patchStrategy(strategy.id, 'armed')}
                                className="rounded border border-neon-green/30 px-1.5 py-1 text-neon-green hover:bg-neon-green/10 disabled:opacity-40"
                              >
                                <Play className="size-3" aria-hidden />
                              </button>
                            )}
                            <button
                              type="button"
                              title="Delete strategy"
                              disabled={strategyBusy === strategy.id}
                              onClick={() => void deleteStrategy(strategy)}
                              className="rounded border border-neon-red/25 px-1.5 py-1 text-neon-red/70 hover:bg-neon-red/10 disabled:opacity-40"
                            >
                              <Trash2 className="size-3" aria-hidden />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => void pulse()}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded border border-primary/35 bg-primary/10 px-3 py-2 font-terminal text-[10px] uppercase tracking-wider text-primary transition-colors hover:bg-primary/15 disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Zap className="size-3" aria-hidden />}
              Pulse active mandate
            </button>

            {reply && <p className="rounded border border-border/60 bg-background/60 p-2 text-[10px] leading-relaxed text-muted-foreground/75">{reply}</p>}

            <div>
              <p className="mb-1.5 font-terminal text-[9px] uppercase tracking-wider text-muted-foreground/55">Recent orders</p>
              {status.recentOrders.length === 0 ? (
                <p className="font-terminal text-[10px] text-muted-foreground/40">No orders recorded yet.</p>
              ) : (
                <div className="space-y-1">
                  {status.recentOrders.slice(0, 4).map((order) => (
                    <div key={order.id} className="flex items-center gap-2 rounded border border-border/50 px-2 py-1.5 font-terminal text-[9px]">
                      <span className={order.side === 'buy' ? 'text-neon-green' : 'text-warning'}>{order.side.toUpperCase()}</span>
                      <span className="text-foreground">{order.symbol}</span>
                      <span className="ml-auto text-muted-foreground/55">{order.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

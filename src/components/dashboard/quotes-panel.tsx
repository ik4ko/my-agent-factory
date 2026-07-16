'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Briefcase, LineChart } from 'lucide-react';
import { useQuotesQuery } from '@/hooks/use-quotes-query';
import { cn } from '@/lib/utils';
import type { QuoteRow } from '@/lib/types/database.types';
import { DEFAULT_SYMBOL } from './trading-chart';

interface Position {
  symbol: string;
  qty: number;
  avgCost: number;
  marketValue: number;
}

interface WatchlistPanelProps {
  selectedSymbol: string;
  onSelectSymbol: (symbol: string) => void;
}

interface LiveQuote {
  symbol: string;
  price: number;
  ts: number;
  change_pct?: number;
  source: string;
}

function useOwnedSymbols() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [ready, setReady] = useState<boolean | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let alive = true;

    void fetch('/api/trading/positions', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data: { positions?: Position[]; ready?: boolean }) => {
        if (!alive) return;
        setPositions(Array.isArray(data.positions) ? data.positions : []);
        setReady(Boolean(data.ready));
      })
      .catch(() => {
        if (!alive) return;
        setPositions([]);
        setReady(false);
      });

    return () => {
      alive = false;
    };
  }, [reloadToken]);

  const owned = useMemo(() => new Set(positions.map((p) => p.symbol.toUpperCase())), [positions]);
  return { owned, positions, ready, retry: () => setReloadToken((value) => value + 1) };
}

/** Live Finnhub-backed quotes for the symbol allowlist, polled by the loop
 *  worker every QUOTE_POLL_MS and streamed here via Supabase Realtime. This
 *  is a read-only display — the risk gate still sizes orders off
 *  getMarketContext()'s Yahoo-backed path, unchanged.
 *
 *  Reskinned to the Instrument Deck quotes ticker (Trading Room.dc.html
 *  §Quotes): a horizontal SIM-tagged strip of symbol · price · delta cells. */
export function QuotesPanel() {
  const { data: quotes = [], isLoading } = useQuotesQuery();

  return (
    <div className="flex min-h-[34px] items-stretch overflow-x-auto rounded-[6px] border border-border/90 bg-surface-deep">
      <div className="flex flex-shrink-0 items-center gap-[7px] border-r border-border/60 px-[13px]">
        <LineChart className="size-3 text-primary" aria-hidden />
        <span className="font-mono text-[8px] tracking-[0.16em] text-[#4c6079]">QUOTES</span>
        <span className="rounded-[2px] border border-warning/40 px-[5px] font-mono text-[7.5px] font-bold text-warning">
          SIM
        </span>
      </div>

      {isLoading ? (
        <span className="flex items-center px-4 font-mono text-[10px] text-ink-mid">Loading quotes…</span>
      ) : quotes.length === 0 ? (
        <span className="flex items-center px-4 font-mono text-[10px] text-ink-low">
          No quotes cached — run the loop worker (npm run loop-worker) to poll the allowlist.
        </span>
      ) : (
        quotes.map((q) => {
          const up = (q.change_pct ?? 0) >= 0;
          return (
            <div
              key={q.symbol}
              className="flex flex-shrink-0 items-center gap-2 border-r border-border/30 px-[15px]"
              title={`${q.source} · ${q.symbol}`}
            >
              <span className="font-mono text-[10px] font-bold text-[#cdd9e8]">{q.symbol}</span>
              <span className="tabular font-mono text-[10.5px] text-ink-mid">${q.price.toFixed(2)}</span>
              <span className={cn('tabular font-mono text-[9px] font-semibold', up ? 'text-neon-green' : 'text-destructive')}>
                {up ? '+' : ''}
                {q.change_pct?.toFixed(2) ?? '0.00'}%
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}

export function WatchlistPanel({ selectedSymbol, onSelectSymbol }: WatchlistPanelProps) {
  const { data: quotes = [], isLoading } = useQuotesQuery();
  const { owned, positions, ready, retry: retryPositions } = useOwnedSymbols();
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [liveQuotes, setLiveQuotes] = useState<Record<string, LiveQuote>>({});
  const [draftSymbol, setDraftSymbol] = useState('');
  const [busySymbol, setBusySymbol] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [watchlistError, setWatchlistError] = useState<string | null>(null);

  const cachedBySymbol = useMemo<Map<string, QuoteRow>>(
    () => new Map(quotes.map((quote) => [quote.symbol.toUpperCase(), quote])),
    [quotes],
  );
  const liveQuoteKeys = useMemo(() => new Set(Object.keys(liveQuotes)), [liveQuotes]);

  const loadWatchlist = async () => {
    setWatchlistError(null);
    const res = await fetch('/api/trading/watchlist', { cache: 'no-store' });
    const data = (await res.json().catch(() => null)) as { symbols?: string[]; error?: string } | null;
    if (!res.ok) {
      const message = data?.error ?? 'watchlist unavailable';
      setWatchlistError(message);
      setWatchlist([]);
      return;
    }
    const next = Array.isArray(data?.symbols) ? data.symbols.map((symbol) => symbol.toUpperCase()) : [];
    setWatchlist(next);
    setWatchlistError(data?.error ?? null);
    setLiveQuotes((prev) => {
      const allowed = new Set(next);
      const nextQuotes: Record<string, LiveQuote> = {};
      for (const [symbol, quote] of Object.entries(prev)) {
        if (allowed.has(symbol)) nextQuotes[symbol] = quote;
      }
      return nextQuotes;
    });
  };

  useEffect(() => {
    void loadWatchlist();
  }, []);

  useEffect(() => {
    if (watchlist.length === 0) return;
    let cancelled = false;

    const pullMissingQuotes = async () => {
      const missing = watchlist.filter((symbol) => !cachedBySymbol.has(symbol) && !liveQuoteKeys.has(symbol));
      if (missing.length === 0) return;

      const results = await Promise.all(
        missing.map(async (symbol) => {
          try {
            const res = await fetch(`/api/market/quotes?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' });
            if (!res.ok) return null;
            const data = (await res.json()) as LiveQuote | { price?: number; ts?: number };
            if (typeof data.price !== 'number' || typeof data.ts !== 'number') return null;
            return [symbol, { symbol, price: data.price, ts: data.ts, source: 'YAHOO' }] as const;
          } catch {
            return null;
          }
        }),
      );

      if (cancelled) return;
      setLiveQuotes((prev) => {
        const next = { ...prev };
        for (const result of results) {
          if (!result) continue;
          next[result[0]] = result[1];
        }
        return next;
      });
    };

    void pullMissingQuotes();
    const timer = setInterval(pullMissingQuotes, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [cachedBySymbol, liveQuoteKeys, watchlist]);

  const positionBySymbol = useMemo(() => {
    const map = new Map<string, Position>();
    for (const position of positions) map.set(position.symbol.toUpperCase(), position);
    return map;
  }, [positions]);

  const activeRows = useMemo(
    () =>
      [...watchlist].sort((a, b) => {
        const aOwned = owned.has(a);
        const bOwned = owned.has(b);
        const aSelected = a === selectedSymbol.toUpperCase();
        const bSelected = b === selectedSymbol.toUpperCase();
        if (aOwned !== bOwned) return aOwned ? -1 : 1;
        if (aSelected !== bSelected) return aSelected ? -1 : 1;
        return a.localeCompare(b);
      }),
    [owned, selectedSymbol, watchlist],
  );

  const upsertWatchlistSymbol = async (symbol: string, active: boolean) => {
    const method = active ? 'POST' : 'DELETE';
    const res = await fetch('/api/trading/watchlist', {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ symbol }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error ?? `watchlist ${active ? 'add' : 'remove'} failed`);
    }
  };

  const handleAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const symbol = draftSymbol.trim().toUpperCase();
    if (!symbol) return;
    setBusySymbol(symbol);
    setStatus(null);
    try {
      await upsertWatchlistSymbol(symbol, true);
      await loadWatchlist();
      onSelectSymbol(symbol);
      setDraftSymbol('');
      setStatus(`added ${symbol}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'watchlist add failed');
    } finally {
      setBusySymbol(null);
    }
  };

  const handleRemove = async (symbol: string) => {
    setBusySymbol(symbol);
    setStatus(null);
    try {
      await upsertWatchlistSymbol(symbol, false);
      const remaining = watchlist.filter((item) => item !== symbol);
      await loadWatchlist();
      if (selectedSymbol.toUpperCase() === symbol) {
        onSelectSymbol(remaining[0] ?? DEFAULT_SYMBOL);
      }
      setStatus(`removed ${symbol}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'watchlist remove failed');
    } finally {
      setBusySymbol(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <LineChart className="size-3.5 text-primary" aria-hidden />
          <span className="font-terminal text-[10px] uppercase tracking-widest text-muted-foreground">Watchlist</span>
          <span className="ml-auto rounded border border-primary/30 px-1.5 py-px font-terminal text-[8.5px] uppercase tracking-wider text-primary/80">
            owned first · click to chart
          </span>
        </div>
        {watchlistError && (
          <div className="flex items-center gap-2 rounded border border-neon-red/25 bg-neon-red/[0.04] px-2 py-1">
            <span className="font-mono text-[9px] text-neon-red/80">{watchlistError}</span>
            <button
              type="button"
              onClick={() => void loadWatchlist()}
              className="ml-auto rounded border border-neon-red/30 px-1.5 py-px font-terminal text-[8px] uppercase tracking-wider text-neon-red/80 transition-colors hover:bg-neon-red/10"
            >
              Retry
            </button>
          </div>
        )}
        <form onSubmit={handleAdd} className="flex items-center gap-2">
          <input
            value={draftSymbol}
            onChange={(event) => setDraftSymbol(event.target.value)}
            placeholder="Add ticker"
            className="h-8 min-w-0 flex-1 rounded border border-border/70 bg-background px-2 font-mono text-[10px] text-foreground outline-none placeholder:text-muted-foreground/35"
          />
          <button
            type="submit"
            disabled={busySymbol !== null}
            className="rounded border border-primary/35 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-primary transition-colors hover:bg-primary/10 disabled:opacity-60"
          >
            Add
          </button>
        </form>
        {status && <p className="font-mono text-[9px] text-muted-foreground/60">{status}</p>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {isLoading && watchlist.length === 0 ? (
          <p className="py-6 text-center font-terminal text-[10px] text-muted-foreground/40">loading watchlist...</p>
        ) : activeRows.length === 0 ? (
          <p className="py-6 text-center font-terminal text-[10px] leading-relaxed text-muted-foreground/45">
            No active watchlist symbols yet. Add one above or keep the loop worker running for the cached allowlist.
          </p>
        ) : (
          <div className="space-y-1.5">
            {activeRows.map((symbol) => {
              const cached = cachedBySymbol.get(symbol);
              const live = liveQuotes[symbol];
              const row = cached ?? live;
              const pos = positionBySymbol.get(symbol);
              const isOwned = Boolean(pos);
              const isSelected = symbol === selectedSymbol.toUpperCase();
              const up = (row?.change_pct ?? 0) >= 0;

              return (
                <div
                  key={symbol}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectSymbol(symbol)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectSymbol(symbol);
                    }
                  }}
                  className={cn(
                    'w-full rounded-md border px-2.5 py-2 text-left transition-colors',
                    isSelected ? 'border-primary/55 bg-primary/[0.10]' : isOwned ? 'border-primary/35 bg-primary/[0.07]' : 'border-border/60 bg-surface-1/50',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-foreground">{symbol}</span>
                    {isOwned && (
                      <span className="inline-flex items-center gap-1 rounded border border-primary/30 px-1.5 py-px font-terminal text-[8px] uppercase tracking-wider text-primary">
                        <Briefcase className="size-2.5" aria-hidden />
                        owned
                      </span>
                    )}
                    {isSelected && (
                      <span className="rounded border border-neon-purple/35 px-1.5 py-px font-terminal text-[8px] uppercase tracking-wider text-agent-codex">
                        charting
                      </span>
                    )}
                    <span className="ml-auto tabular font-mono text-xs text-ink-mid">
                      {row ? `$${row.price.toFixed(2)}` : 'loading…'}
                    </span>
                    <button
                      type="button"
                      disabled={busySymbol === symbol}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleRemove(symbol);
                      }}
                      className="rounded border border-border/60 px-1.5 py-px font-terminal text-[8px] uppercase tracking-wider text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive disabled:opacity-60"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="mt-1 flex items-center gap-2 font-mono text-[10px]">
                    <span className={cn('tabular font-semibold', up ? 'text-neon-green' : 'text-destructive')}>
                      {up ? '+' : ''}
                      {row?.change_pct?.toFixed(2) ?? '0.00'}%
                    </span>
                    <span className="text-muted-foreground/45">{row?.source ?? 'pending'}</span>
                    {pos && <span className="ml-auto text-muted-foreground/60">{pos.qty} sh · ${Math.round(pos.marketValue).toLocaleString()}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border px-3 py-2 font-terminal text-[9px] text-muted-foreground/45">
        {ready === false ? (
          <div className="flex items-center gap-2">
            <span>positions sidecar offline - watchlist still live, owned sorting unavailable</span>
            <button
              type="button"
              onClick={() => retryPositions()}
              className="rounded border border-border/60 px-1.5 py-px font-terminal text-[8px] uppercase tracking-wider text-muted-foreground/70 transition-colors hover:border-primary/35 hover:text-primary"
            >
              Retry
            </button>
          </div>
        ) : (
          `${positions.length} owned symbol${positions.length === 1 ? '' : 's'} tracked`
        )}
      </div>
    </div>
  );
}

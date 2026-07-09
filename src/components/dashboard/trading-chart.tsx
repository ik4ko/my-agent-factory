'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ColorType,
  createChart,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { AGENT_SOCKET_EVENTS_KEY, type AgentSocketEvent } from '@/hooks/use-agent-socket';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface MarketTick {
  symbol: string;
  price: number;
  ts: number;
  provider: string;
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
}

function readTick(event: AgentSocketEvent): MarketTick | null {
  if (event.event !== 'market.tick') return null;
  const p = event.payload;
  if (typeof p.symbol !== 'string' || typeof p.price !== 'number') return null;
  const ind = (p.indicators ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    symbol: p.symbol,
    price: p.price,
    ts: typeof p.ts === 'number' ? p.ts : event.ts,
    provider: typeof p.provider === 'string' ? p.provider : 'unknown',
    rsi: num(ind.rsi),
    macd: num(ind.macd),
    macdSignal: num(ind.macd_signal),
    macdHist: num(ind.macd_hist),
  };
}

const DEFAULT_SYMBOL = 'SPY';
const QUOTE_POLL_MS = 10_000;

interface LiveQuote {
  symbol?: string;
  price?: number;
  ts?: number;
  error?: string;
}

/** Live tick chart for the Trading Room. Two feeds land on the same price
 *  line: market.tick events pushed into the React Query cache by
 *  useAgentSocket (core/alpaca_feed.py, with RSI/MACD precomputed in Python)
 *  when that local bridge is running, and a direct poll of
 *  /api/market/quotes?symbol= (yahoo-finance2) so the price line stays live
 *  even without it. */
export function TradingChart() {
  const { data: events = [] } = useQuery<AgentSocketEvent[]>({
    queryKey: AGENT_SOCKET_EVENTS_KEY,
    queryFn: () => [],
    enabled: false,
    initialData: [],
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceRef = useRef<ISeriesApi<'Line'> | null>(null);
  const rsiRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdRef = useRef<ISeriesApi<'Line'> | null>(null);
  const signalRef = useRef<ISeriesApi<'Line'> | null>(null);
  const histRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const lastTimeRef = useRef<number>(0);

  const [symbol, setSymbol] = useState<string | null>(null);
  const [yahooQuote, setYahooQuote] = useState<{ price: number; ts: number } | null>(null);
  const lastTickAtRef = useRef<number>(0);

  const symbols = useMemo(() => {
    const seen = new Set<string>();
    for (const event of events) {
      const tick = readTick(event);
      if (tick) seen.add(tick.symbol);
    }
    return [...seen].sort();
  }, [events]);

  const activeSymbol = symbol ?? symbols[0] ?? null;
  const chartSymbol = activeSymbol ?? DEFAULT_SYMBOL;

  const latest = useMemo(() => {
    for (const event of events) {
      const tick = readTick(event);
      if (tick && tick.symbol === chartSymbol) return tick;
    }
    return null;
  }, [events, chartSymbol]);

  // Chart lifecycle — created once, torn down on unmount.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8b949e',
        panes: { separatorColor: '#21262d' },
        // The default canvas watermark renders as tofu glyphs on this font
        // stack — replaced by the visible text credit in the panel footer.
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: 'rgba(48, 54, 61, 0.4)' },
        horzLines: { color: 'rgba(48, 54, 61, 0.4)' },
      },
      timeScale: { timeVisible: true, secondsVisible: true, borderColor: '#30363d' },
      rightPriceScale: { borderColor: '#30363d' },
    });

    priceRef.current = chart.addSeries(
      LineSeries,
      { color: '#39d353', lineWidth: 2, priceLineVisible: true },
      0,
    );
    rsiRef.current = chart.addSeries(
      LineSeries,
      { color: '#a78bfa', lineWidth: 1, priceLineVisible: false },
      1,
    );
    histRef.current = chart.addSeries(HistogramSeries, { color: '#30363d', priceLineVisible: false }, 2);
    macdRef.current = chart.addSeries(
      LineSeries,
      { color: '#38bdf8', lineWidth: 1, priceLineVisible: false },
      2,
    );
    signalRef.current = chart.addSeries(
      LineSeries,
      { color: '#f59e0b', lineWidth: 1, priceLineVisible: false },
      2,
    );

    const panes = chart.panes();
    panes[1]?.setHeight(70);
    panes[2]?.setHeight(90);

    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
      priceRef.current = null;
      rsiRef.current = null;
      macdRef.current = null;
      signalRef.current = null;
      histRef.current = null;
    };
  }, []);

  // Reset series when the charted symbol changes.
  useEffect(() => {
    lastTimeRef.current = 0;
    lastTickAtRef.current = 0;
    setYahooQuote(null);
    priceRef.current?.setData([]);
    rsiRef.current?.setData([]);
    macdRef.current?.setData([]);
    signalRef.current?.setData([]);
    histRef.current?.setData([]);
  }, [chartSymbol]);

  // Append fresh ticks. Events arrive newest-first and capped, so walk the
  // buffer oldest-first and only push points past the last painted second.
  useEffect(() => {
    const price = priceRef.current;
    if (!price) return;

    for (let i = events.length - 1; i >= 0; i--) {
      const tick = readTick(events[i]);
      if (!tick || tick.symbol !== chartSymbol) continue;
      const time = Math.floor(tick.ts) as UTCTimestamp;
      if (time < lastTimeRef.current) continue;
      lastTimeRef.current = time;
      lastTickAtRef.current = Date.now();

      price.update({ time, value: tick.price });
      if (tick.rsi !== null) rsiRef.current?.update({ time, value: tick.rsi });
      if (tick.macd !== null) macdRef.current?.update({ time, value: tick.macd });
      if (tick.macdSignal !== null) signalRef.current?.update({ time, value: tick.macdSignal });
      if (tick.macdHist !== null) {
        histRef.current?.update({
          time,
          value: tick.macdHist,
          color: tick.macdHist >= 0 ? 'rgba(57, 211, 83, 0.55)' : 'rgba(248, 81, 73, 0.55)',
        });
      }
    }
  }, [events, chartSymbol]);

  // Poll the live Yahoo-backed quote endpoint. Always recorded to state so
  // it has its own guaranteed, labeled place in the UI (see the YAHOO badge
  // below) — it must never depend on the tick socket to be visible. It only
  // drives the chart's price LINE when the tick socket hasn't posted a tick
  // for this symbol recently; otherwise the two feeds would fight over the
  // same series (tick data — including this dev box's MOCK feed — winning
  // by volume and burying the real Yahoo point).
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const pull = async () => {
      try {
        const res = await fetch(`/api/market/quotes?symbol=${encodeURIComponent(chartSymbol)}`, {
          signal: controller.signal,
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as LiveQuote;
        if (typeof data.price !== 'number' || typeof data.ts !== 'number') return;

        setYahooQuote({ price: data.price, ts: data.ts });

        const tickIsLive = Date.now() - lastTickAtRef.current < QUOTE_POLL_MS * 2;
        const price = priceRef.current;
        if (!price || tickIsLive) return;

        const time = Math.floor(data.ts / 1000) as UTCTimestamp;
        if (time < lastTimeRef.current) return;
        lastTimeRef.current = time;
        price.update({ time, value: data.price });
      } catch {
        /* network hiccup — next poll retries */
      }
    };

    void pull();
    const interval = setInterval(pull, QUOTE_POLL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [chartSymbol]);

  return (
    <div className="relative flex flex-col gap-2 overflow-hidden rounded-[6px] border border-border/90 bg-gradient-to-b from-surface-2 to-background p-3">
      {/* deck corner brackets */}
      <span aria-hidden className="pointer-events-none absolute left-[6px] top-[6px] h-3 w-3 border-l border-t border-primary/40" />
      <span aria-hidden className="pointer-events-none absolute right-[6px] top-[6px] h-3 w-3 border-r border-t border-primary/40" />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9.5px] tracking-[0.2em] text-[#4c6079]">
            ⌐ {chartSymbol} · LIVE
          </span>
          {latest && (
            <span className="tabular font-mono text-[13px] font-bold text-ink-hi">${latest.price.toFixed(2)}</span>
          )}
          {symbols.length === 0 && (
            <span className="flex items-center gap-2 font-mono text-[10px] text-ink-mid" role="status">
              <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-warning" aria-hidden />
              tick bridge offline — RSI/MACD resume on reconnect; price stays live via quote polling
            </span>
          )}
          {symbols.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSymbol(s)}
              className={cn(
                'rounded-[3px] border px-2 py-0.5 font-mono text-[10px] transition-colors',
                s === chartSymbol
                  ? 'border-primary/50 bg-primary/[0.06] text-primary-bright'
                  : 'border-border/60 text-ink-mid hover:text-ink-hi',
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-[5px] font-mono text-[8.5px]">
          <span className="rounded-[3px] border border-primary/35 bg-primary/[0.06] px-[7px] py-[2px] text-primary-bright">EMA-9</span>
          <span className="rounded-[3px] border border-ink-low/25 px-[7px] py-[2px] text-agent-codex">
            RSI-14 {latest?.rsi != null ? latest.rsi.toFixed(1) : '—'}
          </span>
          <span className="rounded-[3px] border border-ink-low/25 px-[7px] py-[2px] text-primary">
            MACD {latest?.macd != null ? latest.macd.toFixed(3) : '—'}
          </span>
          {latest && <Badge variant="muted">{latest.provider}</Badge>}
          {yahooQuote && (
            <span className="flex items-center gap-1.5 text-neon-green" title={`Yahoo Finance quote — ${new Date(yahooQuote.ts).toLocaleTimeString()}`}>
              ${yahooQuote.price.toFixed(2)}
              <Badge variant="cyan">YAHOO</Badge>
            </span>
          )}
        </div>
      </div>
      <div ref={containerRef} className="h-[380px] w-full" />
      <span className="self-end font-mono text-[9px] text-ink-low/40">
        charting by TradingView lightweight-charts™
      </span>
    </div>
  );
}

export default TradingChart;

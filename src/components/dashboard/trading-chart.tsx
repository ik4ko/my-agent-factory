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

/** Live tick chart for the Trading Room. Consumes market.tick events pushed
 *  into the React Query cache by useAgentSocket (core/alpaca_feed.py emits
 *  them over the local agent socket with RSI/MACD precomputed in Python). */
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

  const symbols = useMemo(() => {
    const seen = new Set<string>();
    for (const event of events) {
      const tick = readTick(event);
      if (tick) seen.add(tick.symbol);
    }
    return [...seen].sort();
  }, [events]);

  const activeSymbol = symbol ?? symbols[0] ?? null;

  const latest = useMemo(() => {
    for (const event of events) {
      const tick = readTick(event);
      if (tick && tick.symbol === activeSymbol) return tick;
    }
    return null;
  }, [events, activeSymbol]);

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

  // Reset series when the active symbol changes.
  useEffect(() => {
    lastTimeRef.current = 0;
    priceRef.current?.setData([]);
    rsiRef.current?.setData([]);
    macdRef.current?.setData([]);
    signalRef.current?.setData([]);
    histRef.current?.setData([]);
  }, [activeSymbol]);

  // Append fresh ticks. Events arrive newest-first and capped, so walk the
  // buffer oldest-first and only push points past the last painted second.
  useEffect(() => {
    const price = priceRef.current;
    if (!price || !activeSymbol) return;

    for (let i = events.length - 1; i >= 0; i--) {
      const tick = readTick(events[i]);
      if (!tick || tick.symbol !== activeSymbol) continue;
      const time = Math.floor(tick.ts) as UTCTimestamp;
      if (time < lastTimeRef.current) continue;
      lastTimeRef.current = time;

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
  }, [events, activeSymbol]);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {symbols.length === 0 && (
            <span className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
              <span className="size-1.5 shrink-0 rounded-full bg-neon-orange animate-pulse" aria-hidden />
              Live tick stream offline — reconnecting automatically. Charts resume as soon as the
              market-data bridge is back online.
            </span>
          )}
          {symbols.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSymbol(s)}
              className={cn(
                'rounded-md border border-border px-2 py-0.5 font-terminal text-xs transition-colors',
                s === activeSymbol
                  ? 'border-neon-green/50 text-neon-green'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {s}
            </button>
          ))}
        </div>
        {latest && (
          <div className="flex items-center gap-3 font-terminal text-xs">
            <span className="text-foreground">${latest.price.toFixed(2)}</span>
            <span className="text-[#a78bfa]">RSI {latest.rsi?.toFixed(1) ?? '—'}</span>
            <span className="text-[#38bdf8]">MACD {latest.macd?.toFixed(3) ?? '—'}</span>
            <Badge variant="muted">{latest.provider}</Badge>
          </div>
        )}
      </div>
      <div ref={containerRef} className="h-[380px] w-full" />
      <span className="self-end font-terminal text-[9px] text-muted-foreground/30">
        charting by TradingView lightweight-charts™
      </span>
    </div>
  );
}

export default TradingChart;

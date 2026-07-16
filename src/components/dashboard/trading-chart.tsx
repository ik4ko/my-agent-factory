'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  LineSeries,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
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
}

interface Candle {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface CandleResponse {
  symbol?: string;
  interval?: string;
  range?: string;
  source?: string;
  asOf?: string;
  candles?: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  error?: string;
}

interface LiveQuote {
  symbol?: string;
  price?: number;
  ts?: number;
  error?: string;
}

export const DEFAULT_SYMBOL = 'SPY';
const QUOTE_POLL_MS = 10_000;
const PREVIEW_CANDLE_SPACE = 10;

const RANGE_OPTIONS = ['1d', '5d', '1mo'] as const;
const INTERVAL_OPTIONS = ['1m', '5m', '15m', '1d'] as const;

interface TradingChartProps {
  selectedSymbol: string;
  onSelectSymbol: (symbol: string) => void;
}

function readTick(event: AgentSocketEvent): MarketTick | null {
  if (event.event !== 'market.tick') return null;
  const p = event.payload;
  if (typeof p.symbol !== 'string' || typeof p.price !== 'number') return null;
  return {
    symbol: p.symbol,
    price: p.price,
    ts: typeof p.ts === 'number' ? p.ts : event.ts,
    provider: typeof p.provider === 'string' ? p.provider : 'unknown',
  };
}

function intervalSeconds(interval: string): number {
  switch (interval) {
    case '1m':
      return 60;
    case '5m':
      return 5 * 60;
    case '15m':
      return 15 * 60;
    case '1d':
      return 24 * 60 * 60;
    default:
      return 5 * 60;
  }
}

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function ema(values: Array<number | null>, period: number): Array<number | null> {
  const out: Array<number | null> = Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let seeded = false;
  let last = 0;
  let window: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || !Number.isFinite(v)) {
      window = [];
      seeded = false;
      continue;
    }
    if (!seeded) {
      window.push(v);
      if (window.length === period) {
        last = window.reduce((sum, n) => sum + n, 0) / period;
        out[i] = last;
        seeded = true;
      }
      continue;
    }
    last = v * k + last * (1 - k);
    out[i] = last;
  }
  return out;
}

function rsi(closes: number[], period = 14): Array<number | null> {
  const out: Array<number | null> = Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta >= 0) gain += delta;
    else loss -= delta;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, delta)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -delta)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function sameUtcDay(a: UTCTimestamp, b: UTCTimestamp): boolean {
  const da = new Date(a * 1000);
  const db = new Date(b * 1000);
  return da.getUTCFullYear() === db.getUTCFullYear() && da.getUTCMonth() === db.getUTCMonth() && da.getUTCDate() === db.getUTCDate();
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function computeIndicators(candles: Candle[]) {
  const closes = candles.map((c) => c.close);
  const rsiValues = rsi(closes);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdValues = closes.map((_, i) => (ema12[i] !== null && ema26[i] !== null ? round(ema12[i]! - ema26[i]!) : null));
  const signalValues = ema(macdValues, 9);

  let currentDay: UTCTimestamp | null = null;
  let pv = 0;
  let vol = 0;
  let dayTypical: number[] = [];
  const vwapMid: LineData<UTCTimestamp>[] = [];
  const vwapTop: LineData<UTCTimestamp>[] = [];
  const vwapBottom: LineData<UTCTimestamp>[] = [];

  for (const candle of candles) {
    if (currentDay === null || !sameUtcDay(currentDay, candle.time)) {
      currentDay = candle.time;
      pv = 0;
      vol = 0;
      dayTypical = [];
    }
    const typical = (candle.high + candle.low + candle.close) / 3;
    const volume = Math.max(1, candle.volume || 1);
    pv += typical * volume;
    vol += volume;
    dayTypical.push(typical);
    const mid = pv / vol;
    const band = std(dayTypical);
    vwapMid.push({ time: candle.time, value: round(mid) });
    vwapTop.push({ time: candle.time, value: round(mid + band) });
    vwapBottom.push({ time: candle.time, value: round(mid - band) });
  }

  return {
    rsi: rsiValues
      .map((value, i) => (value === null ? null : { time: candles[i].time, value: round(value, 2) }))
      .filter((p): p is LineData<UTCTimestamp> => Boolean(p)),
    macd: macdValues
      .map((value, i) => (value === null ? null : { time: candles[i].time, value: round(value) }))
      .filter((p): p is LineData<UTCTimestamp> => Boolean(p)),
    signal: signalValues
      .map((value, i) => (value === null ? null : { time: candles[i].time, value: round(value) }))
      .filter((p): p is LineData<UTCTimestamp> => Boolean(p)),
    hist: macdValues
      .map((value, i): HistogramData<UTCTimestamp> | null => {
        const signal = signalValues[i];
        if (value === null || signal === null) return null;
        const h = round(value - signal);
        return { time: candles[i].time, value: h, color: h >= 0 ? 'rgba(57, 211, 83, 0.55)' : 'rgba(248, 81, 73, 0.55)' };
      })
      .filter((p): p is HistogramData<UTCTimestamp> => Boolean(p)),
    vwapMid,
    vwapTop,
    vwapBottom,
    volume: candles.map((candle) => ({
      time: candle.time,
      value: round(candle.volume, 0),
      color: candle.close >= candle.open ? 'rgba(57, 211, 83, 0.35)' : 'rgba(248, 81, 73, 0.35)',
    })),
  };
}

function normalizeCandles(raw: CandleResponse): Candle[] {
  return (raw.candles ?? [])
    .filter(
      (c) =>
        typeof c.time === 'number' &&
        typeof c.open === 'number' &&
        typeof c.high === 'number' &&
        typeof c.low === 'number' &&
        typeof c.close === 'number',
    )
    .map((c) => ({
      time: c.time as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: typeof c.volume === 'number' ? c.volume : 0,
    }))
    .sort((a, b) => a.time - b.time);
}

/** Trading Room candlestick chart with a 10-candle right-side planning lane,
 *  RSI, MACD, and VWAP ± session deviation bands. Yahoo is only the local
 *  dev/default chart feed; it is not treated as low-latency execution data. */
export function TradingChart({ selectedSymbol, onSelectSymbol }: TradingChartProps) {
  const { data: events = [] } = useQuery<AgentSocketEvent[]>({
    queryKey: AGENT_SOCKET_EVENTS_KEY,
    queryFn: () => [],
    enabled: false,
    initialData: [],
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const vwapTopRef = useRef<ISeriesApi<'Line'> | null>(null);
  const vwapMidRef = useRef<ISeriesApi<'Line'> | null>(null);
  const vwapBottomRef = useRef<ISeriesApi<'Line'> | null>(null);
  const rsiRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdRef = useRef<ISeriesApi<'Line'> | null>(null);
  const signalRef = useRef<ISeriesApi<'Line'> | null>(null);
  const histRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const [range, setRange] = useState<(typeof RANGE_OPTIONS)[number]>('5d');
  const [interval, setIntervalValue] = useState<(typeof INTERVAL_OPTIONS)[number]>('5m');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [source, setSource] = useState('YAHOO');
  const [loading, setLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [yahooQuote, setYahooQuote] = useState<{ price: number; ts: number } | null>(null);
  const [lastProvider, setLastProvider] = useState('YAHOO');

  const symbols = useMemo(() => {
    const seen = new Set<string>([DEFAULT_SYMBOL, selectedSymbol.toUpperCase()]);
    for (const event of events) {
      const tick = readTick(event);
      if (tick) seen.add(tick.symbol);
    }
    return [...seen].sort();
  }, [events, selectedSymbol]);

  const chartSymbol = (selectedSymbol || DEFAULT_SYMBOL).toUpperCase();
  const latest = candles.at(-1) ?? null;
  const indicators = useMemo(() => computeIndicators(candles), [candles]);

  // Chart lifecycle.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8b949e',
        panes: { separatorColor: '#21262d' },
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: 'rgba(48, 54, 61, 0.38)' },
        horzLines: { color: 'rgba(48, 54, 61, 0.38)' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: interval !== '1d',
        borderColor: '#30363d',
        rightOffset: PREVIEW_CANDLE_SPACE,
        barSpacing: 8,
      },
      rightPriceScale: { borderColor: '#30363d' },
    });

    candleRef.current = chart.addSeries(
      CandlestickSeries,
      {
        upColor: '#39d353',
        downColor: '#f85149',
        borderUpColor: '#39d353',
        borderDownColor: '#f85149',
        wickUpColor: '#39d353',
        wickDownColor: '#f85149',
        priceLineVisible: true,
      },
      0,
    );
    vwapTopRef.current = chart.addSeries(LineSeries, { color: 'rgba(56, 189, 248, 0.5)', lineWidth: 1, priceLineVisible: false }, 0);
    vwapMidRef.current = chart.addSeries(LineSeries, { color: '#38bdf8', lineWidth: 2, priceLineVisible: false }, 0);
    vwapBottomRef.current = chart.addSeries(LineSeries, { color: 'rgba(56, 189, 248, 0.5)', lineWidth: 1, priceLineVisible: false }, 0);
    rsiRef.current = chart.addSeries(LineSeries, { color: '#a78bfa', lineWidth: 1, priceLineVisible: false }, 1);
    histRef.current = chart.addSeries(HistogramSeries, { color: '#30363d', priceLineVisible: false }, 2);
    macdRef.current = chart.addSeries(LineSeries, { color: '#38bdf8', lineWidth: 1, priceLineVisible: false }, 2);
    signalRef.current = chart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 1, priceLineVisible: false }, 2);
    volumeRef.current = chart.addSeries(HistogramSeries, { color: '#30363d', priceLineVisible: false }, 3);

    const panes = chart.panes();
    panes[1]?.setHeight(86);
    panes[2]?.setHeight(114);
    panes[3]?.setHeight(82);
    chartRef.current = chart;

    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      vwapTopRef.current = null;
      vwapMidRef.current = null;
      vwapBottomRef.current = null;
      rsiRef.current = null;
      macdRef.current = null;
      volumeRef.current = null;
      signalRef.current = null;
      histRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.timeScale().applyOptions({
      secondsVisible: interval !== '1d',
      rightOffset: PREVIEW_CANDLE_SPACE,
      barSpacing: interval === '1d' ? 9 : 7,
    });
  }, [interval]);

  // Historical candle pull.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setYahooQuote(null);
    setChartError(null);

    const pullHistory = async () => {
      try {
        const res = await fetch(
          `/api/market/quotes?symbol=${encodeURIComponent(chartSymbol)}&candles=1&range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`,
          { signal: controller.signal, cache: 'no-store' },
        );
        const data = (await res.json().catch(() => ({}))) as CandleResponse;
        if (!res.ok) throw new Error(data.error ?? 'chart unavailable');
        if (controller.signal.aborted) return;
        setCandles(normalizeCandles(data));
        setSource(data.source ?? 'YAHOO');
      } catch (err) {
        if (!controller.signal.aborted) {
          setCandles([]);
          setChartError(err instanceof Error ? err.message : 'chart unavailable');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void pullHistory();

    return () => controller.abort();
  }, [chartSymbol, range, interval, reloadNonce]);

  // Paint all candles + indicators after history or live updates.
  useEffect(() => {
    candleRef.current?.setData(candles as CandlestickData<UTCTimestamp>[]);
    vwapTopRef.current?.setData(indicators.vwapTop);
    vwapMidRef.current?.setData(indicators.vwapMid);
    vwapBottomRef.current?.setData(indicators.vwapBottom);
    rsiRef.current?.setData(indicators.rsi);
    macdRef.current?.setData(indicators.macd);
    signalRef.current?.setData(indicators.signal);
    histRef.current?.setData(indicators.hist);
    volumeRef.current?.setData(indicators.volume);
    if (candles.length > 0) chartRef.current?.timeScale().fitContent();
    chartRef.current?.timeScale().applyOptions({ rightOffset: PREVIEW_CANDLE_SPACE });
  }, [candles, indicators]);

  const updateCurrentCandle = (price: number, tsMs: number, provider: string) => {
    const step = intervalSeconds(interval);
    const bucket = (Math.floor(tsMs / 1000 / step) * step) as UTCTimestamp;
    setLastProvider(provider);
    setCandles((prev) => {
      const last = prev.at(-1);
      if (!last) {
        return [{ time: bucket, open: price, high: price, low: price, close: price, volume: 0 }];
      }
      if (bucket > last.time) {
        return [...prev, { time: bucket, open: last.close, high: Math.max(last.close, price), low: Math.min(last.close, price), close: price, volume: 0 }];
      }
      const next = [...prev];
      next[next.length - 1] = {
        ...last,
        high: Math.max(last.high, price),
        low: Math.min(last.low, price),
        close: price,
      };
      return next;
    });
  };

  // Tick bridge updates the current candle when available.
  useEffect(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const tick = readTick(events[i]);
      if (!tick || tick.symbol !== chartSymbol) continue;
      updateCurrentCandle(tick.price, tick.ts * 1000, tick.provider);
      break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, chartSymbol]);

  // Yahoo quote polling keeps the current candle alive even without socket ticks.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const pull = async () => {
      try {
        const res = await fetch(`/api/market/quotes?symbol=${encodeURIComponent(chartSymbol)}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as LiveQuote;
        if (typeof data.price !== 'number' || typeof data.ts !== 'number') return;
        setYahooQuote({ price: data.price, ts: data.ts });
        updateCurrentCandle(data.price, data.ts, 'YAHOO');
      } catch {
        /* next poll retries */
      }
    };

    void pull();
    const timer = setInterval(pull, QUOTE_POLL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartSymbol, interval]);

  const lastRsi = indicators.rsi.at(-1)?.value;
  const latestVolume = latest?.volume ?? 0;
  const dayVolume = latest ? candles.filter((candle) => sameUtcDay(candle.time, latest.time)).reduce((sum, candle) => sum + candle.volume, 0) : 0;
  const lastMacd = indicators.macd.at(-1)?.value;
  const lastVwap = indicators.vwapMid.at(-1)?.value;

  return (
    <div className="relative flex flex-col gap-2 overflow-hidden rounded-[6px] border border-border/90 bg-gradient-to-b from-surface-2 to-background p-3">
      <span aria-hidden className="pointer-events-none absolute left-[6px] top-[6px] h-3 w-3 border-l border-t border-primary/40" />
      <span aria-hidden className="pointer-events-none absolute right-[6px] top-[6px] h-3 w-3 border-r border-t border-primary/40" />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[9.5px] tracking-[0.2em] text-[#4c6079]">
            ⌐ {chartSymbol} · CANDLES · +{PREVIEW_CANDLE_SPACE} PLAN
          </span>
          {latest && <span className="tabular font-mono text-[13px] font-bold text-ink-hi">${latest.close.toFixed(2)}</span>}
          {symbols.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSelectSymbol(s)}
              className={cn(
                'rounded-[3px] border px-2 py-0.5 font-mono text-[10px] transition-colors',
                s === chartSymbol ? 'border-primary/50 bg-primary/[0.06] text-primary-bright' : 'border-border/60 text-ink-mid hover:text-ink-hi',
              )}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-[5px] font-mono text-[8.5px]">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setRange(option)}
              className={cn('rounded-[3px] border px-[7px] py-[2px]', range === option ? 'border-primary/45 text-primary' : 'border-border/60 text-ink-mid')}
            >
              {option.toUpperCase()}
            </button>
          ))}
          {INTERVAL_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setIntervalValue(option)}
              className={cn('rounded-[3px] border px-[7px] py-[2px]', interval === option ? 'border-neon-purple/45 text-agent-codex' : 'border-border/60 text-ink-mid')}
            >
              {option}
            </button>
          ))}
          <span className="rounded-[3px] border border-primary/35 bg-primary/[0.06] px-[7px] py-[2px] text-primary-bright">
            VWAP {lastVwap != null ? `$${lastVwap.toFixed(2)}` : '—'}
          </span>
          <span className="rounded-[3px] border border-ink-low/25 px-[7px] py-[2px] text-agent-codex">
            RSI {lastRsi != null ? lastRsi.toFixed(1) : '—'}
          </span>
          <span className="rounded-[3px] border border-ink-low/25 px-[7px] py-[2px] text-primary">
            MACD {lastMacd != null ? lastMacd.toFixed(3) : '—'}
          </span>
          <span className="rounded-[3px] border border-ink-low/25 px-[7px] py-[2px] text-warning">
            VOL {latestVolume.toLocaleString('en-US')}
          </span>
          <span className="rounded-[3px] border border-ink-low/25 px-[7px] py-[2px] text-warning">
            DAY {dayVolume.toLocaleString('en-US')}
          </span>
          <Badge variant={source === 'YAHOO' ? 'cyan' : 'muted'}>{lastProvider || source}</Badge>
          {loading && <span className="text-warning">loading...</span>}
          {yahooQuote && (
            <span className="text-neon-green" title={`Yahoo quote — ${new Date(yahooQuote.ts).toLocaleTimeString()}`}>
              live ${yahooQuote.price.toFixed(2)}
            </span>
          )}
        </div>
      </div>

      {chartError && (
        <div className="flex items-center gap-2 rounded border border-neon-red/30 bg-neon-red/[0.05] px-2 py-1 font-mono text-[9px] text-neon-red/85">
          <span className="min-w-0 flex-1">{chartError}</span>
          <button
            type="button"
            onClick={() => setReloadNonce((n) => n + 1)}
            className="rounded border border-neon-red/35 px-1.5 py-px uppercase tracking-wider text-neon-red/80 transition-colors hover:bg-neon-red/10"
          >
            Retry
          </button>
        </div>
      )}

      <div ref={containerRef} className="h-[min(60vh,560px)] w-full" />
      <div className="flex justify-between gap-2 font-mono text-[9px] text-ink-low/45">
        <span>VWAP bands: top / mid / bottom · RSI pane · MACD pane · candle volume pane</span>
        <span>charting by TradingView lightweight-charts™ · candles via Yahoo dev feed</span>
      </div>
    </div>
  );
}

export default TradingChart;

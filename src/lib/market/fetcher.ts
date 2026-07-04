/**
 * Live market telemetry ingestion — Phase 7 (server-side only).
 *
 * Provider chain:
 *  1. Yahoo Finance chart API (unauthenticated, no key, one request per pull:
 *     3 months of daily bars → price, volume, RSI(14), SMA20/50 computed here
 *     with Wilder smoothing rather than trusting a third-party indicator).
 *  2. Deterministic SIMULATED generator when the network path fails or
 *     returns insufficient bars — volatile-but-bounded values, ALWAYS
 *     labeled source:'SIMULATED' so no downstream consumer can mistake
 *     synthetic data for real telemetry.
 *
 * Every context is stamped with its source; the Hermes prompt block includes
 * it verbatim.
 */

export interface MarketContext {
  ticker: string;
  price: number;
  previousClose: number;
  changePct: number;
  /** Latest daily volume. */
  volume: number;
  avgVolume20d: number;
  rsi14: number;
  sma20: number;
  sma50: number;
  /** Price distance from SMA, in % (positive = above). */
  sma20DistancePct: number;
  sma50DistancePct: number;
  asOf: string;
  source: 'YAHOO' | 'SIMULATED';
}

const YAHOO_TIMEOUT_MS = 8_000;

/** Wilder-smoothed RSI(14). Returns null with fewer than 15 closes. */
export function computeRsi14(closes: number[]): number | null {
  const PERIOD = 14;
  if (closes.length < PERIOD + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= PERIOD; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta >= 0) gain += delta;
    else loss -= delta;
  }
  let avgGain = gain / PERIOD;
  let avgLoss = loss / PERIOD;
  for (let i = PERIOD + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    avgGain = (avgGain * (PERIOD - 1) + Math.max(0, delta)) / PERIOD;
    avgLoss = (avgLoss * (PERIOD - 1) + Math.max(0, -delta)) / PERIOD;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Simple moving average of the trailing n values; null if insufficient. */
export function sma(values: number[], n: number): number | null {
  if (values.length < n) return null;
  const tail = values.slice(-n);
  return tail.reduce((acc, v) => acc + v, 0) / n;
}

interface DailyBars {
  closes: number[];
  volumes: number[];
  price: number;
  previousClose: number;
  asOf: string;
}

/** Minimal defensive parse of Yahoo's chart payload. Null on any surprise. */
async function fetchYahooDaily(ticker: string): Promise<DailyBars | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=3mo&interval=1d`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(YAHOO_TIMEOUT_MS),
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgentFactory/1.0)' },
  });
  if (!res.ok) return null;

  const json: unknown = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (json as any)?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const meta = result?.meta;
  if (!quote || !meta) return null;

  const rawCloses: unknown[] = Array.isArray(quote.close) ? quote.close : [];
  const rawVolumes: unknown[] = Array.isArray(quote.volume) ? quote.volume : [];
  const closes: number[] = [];
  const volumes: number[] = [];
  for (let i = 0; i < rawCloses.length; i++) {
    const c = rawCloses[i];
    const v = rawVolumes[i];
    if (typeof c === 'number' && Number.isFinite(c)) {
      closes.push(c);
      volumes.push(typeof v === 'number' && Number.isFinite(v) ? v : 0);
    }
  }

  const price = typeof meta.regularMarketPrice === 'number' ? meta.regularMarketPrice : closes.at(-1);
  const previousClose =
    typeof meta.chartPreviousClose === 'number' ? meta.chartPreviousClose : closes.at(-2);
  if (typeof price !== 'number' || typeof previousClose !== 'number' || closes.length < 21) {
    return null;
  }
  return { closes, volumes, price, previousClose, asOf: new Date().toISOString() };
}

/** Deterministic per-(ticker, hour) synthetic feed. Bounded but volatile. */
function simulatedContext(ticker: string): MarketContext {
  // Cheap stable hash: ticker chars + current UTC hour bucket.
  let h = 0;
  const bucket = `${ticker}:${Math.floor(Date.now() / 3_600_000)}`;
  for (let i = 0; i < bucket.length; i++) h = (h * 31 + bucket.charCodeAt(i)) >>> 0;
  const unit = (offset: number) => (((h >>> offset) & 0xffff) / 0xffff); // 0..1

  const price = 40 + unit(0) * 460; // $40–$500
  const changePct = (unit(4) - 0.5) * 6; // ±3%
  const previousClose = price / (1 + changePct / 100);
  const rsi14 = 18 + unit(8) * 64; // 18–82: crosses both trigger zones over time
  const sma20 = price * (1 - (unit(12) - 0.5) * 0.08);
  const sma50 = price * (1 - (unit(2) - 0.5) * 0.16);
  const volume = Math.round(1_000_000 + unit(6) * 90_000_000);

  return {
    ticker,
    price: round2(price),
    previousClose: round2(previousClose),
    changePct: round2(changePct),
    volume,
    avgVolume20d: Math.round(volume * (0.7 + unit(10) * 0.6)),
    rsi14: round2(rsi14),
    sma20: round2(sma20),
    sma50: round2(sma50),
    sma20DistancePct: round2(((price - sma20) / sma20) * 100),
    sma50DistancePct: round2(((price - sma50) / sma50) * 100),
    asOf: new Date().toISOString(),
    source: 'SIMULATED',
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Unified ingestion: live Yahoo bars when reachable and sufficient,
 * otherwise the labeled simulated feed. Never throws.
 */
export async function getMarketContext(ticker: string): Promise<MarketContext> {
  const t = ticker.toUpperCase();
  try {
    const bars = await fetchYahooDaily(t);
    if (bars) {
      const rsi = computeRsi14(bars.closes);
      const sma20 = sma(bars.closes, 20);
      const sma50 = sma(bars.closes, 50) ?? sma20; // short histories degrade gracefully
      const avgVol = sma(bars.volumes, 20);
      if (rsi !== null && sma20 !== null && sma50 !== null && avgVol !== null) {
        return {
          ticker: t,
          price: round2(bars.price),
          previousClose: round2(bars.previousClose),
          changePct: round2(((bars.price - bars.previousClose) / bars.previousClose) * 100),
          volume: bars.volumes.at(-1) ?? 0,
          avgVolume20d: Math.round(avgVol),
          rsi14: round2(rsi),
          sma20: round2(sma20),
          sma50: round2(sma50),
          sma20DistancePct: round2(((bars.price - sma20) / sma20) * 100),
          sma50DistancePct: round2(((bars.price - sma50) / sma50) * 100),
          asOf: bars.asOf,
          source: 'YAHOO',
        };
      }
    }
  } catch {
    /* network/parse failure → simulated fallback below */
  }
  return simulatedContext(t);
}

/** Words that look like tickers but never are, in this domain's prose. */
const TICKER_STOPLIST = new Set([
  'ETF', 'ETFS', 'USD', 'RSI', 'MACD', 'SMA', 'EMA', 'IV', 'CPI', 'FED',
  'CALL', 'PUT', 'CALLS', 'PUTS', 'THE', 'AND', 'FOR', 'ON', 'A', 'AN',
  'LLM', 'API', 'ET', 'UTC', 'OTM', 'ITM', 'ATM', 'YOLO', 'PAPER', 'LIVE',
]);

/** Pull the target ticker out of a free-text objective ("$SOXS" wins, then
 *  the first plausible uppercase token); falls back to SPY. */
export function extractTickerFromObjective(objective: string, fallback = 'SPY'): string {
  const dollar = objective.match(/\$([A-Za-z]{1,6})\b/);
  if (dollar) return dollar[1].toUpperCase();
  const tokens = objective.match(/\b[A-Z]{2,6}\b/g) ?? [];
  for (const token of tokens) {
    if (!TICKER_STOPLIST.has(token)) return token;
  }
  return fallback;
}

/** The un-overrideable telemetry block injected into Hermes's system prompt. */
export function formatMarketBlock(m: MarketContext): string {
  return `=== LIVE MARKET TELEMETRY (source: ${m.source} · as of ${m.asOf}) ===
TICKER: ${m.ticker}
PRICE: $${m.price.toFixed(2)} (prev close $${m.previousClose.toFixed(2)}, ${m.changePct >= 0 ? '+' : ''}${m.changePct.toFixed(2)}%)
VOLUME: ${m.volume.toLocaleString('en-US')} (20d avg ${m.avgVolume20d.toLocaleString('en-US')})
RSI(14): ${m.rsi14.toFixed(1)}
SMA20: $${m.sma20.toFixed(2)} (price ${m.sma20DistancePct >= 0 ? '+' : ''}${m.sma20DistancePct.toFixed(2)}% vs SMA20)
SMA50: $${m.sma50.toFixed(2)} (price ${m.sma50DistancePct >= 0 ? '+' : ''}${m.sma50DistancePct.toFixed(2)}% vs SMA50)
=== END TELEMETRY ===`;
}

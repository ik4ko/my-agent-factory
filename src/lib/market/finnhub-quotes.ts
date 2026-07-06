// Live-quote REST polling — the same pattern as news/finnhub.ts, applied to
// price data instead of headlines, per the operator's choice (REST polling,
// not a WebSocket) to stay consistent with the rest of this system rather
// than introduce a persistent-socket subsystem for one feed.
//
// This cache (public.quotes) is a DISPLAY/TRIGGER cache — the risk gate and
// DryRunAdapter still size orders off getMarketContext()'s Yahoo-backed
// path (src/lib/market/fetcher.ts), unchanged. This module additionally
// emits `events` rows of type='price' on a meaningful move since the last
// poll, which the loop engine's existing dispatchEvents() already matches
// against any loop's `{type:'price', symbol, minSeverity}` trigger — no
// engine changes were needed to wire this in.
import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import type { EventSeverity } from '@/lib/types/database.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

const TIMEOUT_MS = 8_000;

function allowlistSymbols(): string[] {
  const raw = process.env.SYMBOL_ALLOWLIST?.trim();
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
}

function moveThresholdPct(): number {
  const v = Number(process.env.QUOTE_MOVE_THRESHOLD_PCT);
  return Number.isFinite(v) && v > 0 ? v : 1.5;
}

function severityForMove(absPct: number): EventSeverity {
  if (absPct >= 5) return 'critical';
  if (absPct >= 3) return 'high';
  if (absPct >= 1.5) return 'med';
  return 'low';
}

interface FinnhubQuote {
  c: number; // current price
  d: number | null; // change
  dp: number | null; // percent change (day)
  h: number; // high
  l: number; // low
  o: number; // open
  pc: number; // previous close
  t: number; // unix seconds
}

async function fetchQuote(symbol: string, apiKey: string): Promise<FinnhubQuote | null> {
  const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`finnhub quote ${symbol} ${res.status}`);
  const json = (await res.json()) as FinnhubQuote;
  return typeof json?.c === 'number' && json.c > 0 ? json : null;
}

export interface QuotePollResult {
  polled: number;
  updated: number;
  priceEvents: number;
  degraded: boolean;
  reason?: string;
}

/** One poll cycle: fetch every allowlist symbol's quote, upsert the cache,
 *  and emit a `price` event for any symbol that moved past the threshold
 *  since its LAST cached price (not just the day's open-to-now change —
 *  that would refire identically every cycle for an already-volatile day). */
export async function pollAndCacheQuotes(): Promise<QuotePollResult> {
  const apiKey = process.env.FINNHUB_API_KEY?.trim();
  const symbols = allowlistSymbols();
  if (!apiKey || symbols.length === 0) {
    return { polled: 0, updated: 0, priceEvents: 0, degraded: true, reason: !apiKey ? 'FINNHUB_API_KEY not set' : 'SYMBOL_ALLOWLIST empty' };
  }

  const { data: prior } = await db().from('quotes').select('symbol, price').in('symbol', symbols);
  const priorBySymbol = new Map(((prior ?? []) as { symbol: string; price: number }[]).map((q) => [q.symbol, Number(q.price)]));

  const threshold = moveThresholdPct();
  let updated = 0;
  let priceEvents = 0;

  for (const symbol of symbols) {
    try {
      const quote = await fetchQuote(symbol, apiKey);
      if (!quote) continue;

      await db()
        .from('quotes')
        .upsert(
          {
            symbol,
            price: quote.c,
            change: quote.d,
            change_pct: quote.dp,
            high: quote.h,
            low: quote.l,
            open: quote.o,
            prev_close: quote.pc,
            source: 'finnhub',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'symbol' }
        );
      updated++;

      const lastPrice = priorBySymbol.get(symbol);
      if (lastPrice && lastPrice > 0) {
        const movePct = ((quote.c - lastPrice) / lastPrice) * 100;
        if (Math.abs(movePct) >= threshold) {
          await db().from('events').insert({
            type: 'price',
            symbol,
            severity: severityForMove(Math.abs(movePct)),
            payload: { price: quote.c, priorPrice: lastPrice, movePct: Math.round(movePct * 100) / 100, source: 'finnhub' },
          });
          priceEvents++;
        }
      }
    } catch (err) {
      await hermesLog('warn', `[QUOTES] ${symbol} poll failed: ${String(err).replace(/\s+/g, ' ').slice(0, 160)}`);
    }
  }

  return { polled: symbols.length, updated, priceEvents, degraded: false };
}

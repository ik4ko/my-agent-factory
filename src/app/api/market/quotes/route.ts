import { NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';
import { getAdminClient } from '@/lib/supabase/admin';
import { withToolTimeout } from '@/lib/tools/live-tools';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

/** GET /api/market/quotes[?symbol=AAPL]
 *  - No `symbol`: the loop-worker's Finnhub REST-poll cache (Supabase `quotes`
 *    table). Read-only; the dashboard also gets these live via Supabase
 *    Realtime, this route just backs the initial load.
 *  - `?symbol=`: a live single-symbol quote straight from Yahoo Finance,
 *    used by the Trading Room chart to drive its price line. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get('symbol');
  const candles = url.searchParams.get('candles') === '1';

  if (symbol) {
    try {
      if (candles) {
        const range = url.searchParams.get('range') ?? '5d';
        const interval = url.searchParams.get('interval') ?? '5m';
        const chart = await withToolTimeout(
          yahooFinance.chart(symbol.toUpperCase(), {
            period1: new Date(Date.now() - rangeToMs(range)),
            interval: interval as '1m' | '2m' | '5m' | '15m' | '30m' | '60m' | '90m' | '1h' | '1d',
            includePrePost: false,
          }),
          'Yahoo chart',
        );
        const rows = chart.quotes
          .filter(
            (q) =>
              q.date instanceof Date &&
              typeof q.open === 'number' &&
              typeof q.high === 'number' &&
              typeof q.low === 'number' &&
              typeof q.close === 'number',
          )
          .map((q) => ({
            time: Math.floor(q.date.getTime() / 1000),
            open: q.open,
            high: q.high,
            low: q.low,
            close: q.close,
            volume: typeof q.volume === 'number' ? q.volume : 0,
          }));
        return NextResponse.json({
          symbol: chart.meta.symbol,
          interval,
          range,
          candles: rows,
          source: 'YAHOO',
          asOf: new Date().toISOString(),
        });
      }

      const quote = await withToolTimeout(yahooFinance.quote(symbol.toUpperCase()), 'Yahoo quote');
      if (typeof quote.regularMarketPrice !== 'number') {
        return NextResponse.json({ error: `No live price for ${symbol}` }, { status: 502 });
      }
      return NextResponse.json({
        symbol: quote.symbol,
        price: quote.regularMarketPrice,
        ts: (quote.regularMarketTime ?? new Date()).getTime(),
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Yahoo quote failed' },
        { status: 502 },
      );
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getAdminClient() as any;
  const { data, error } = await db.from('quotes').select('*').order('symbol', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // The worker cache is the durable symbol list and fallback, not the source
  // served as "live" data. Refresh every symbol concurrently so an idle or
  // stopped worker cannot leave the dashboard presenting days-old prices.
  const cachedQuotes = (data ?? []) as Array<Record<string, unknown> & { symbol: string }>;
  const refreshed = await Promise.all(
    cachedQuotes.map(async (cached) => {
      try {
        const quote = await withToolTimeout(yahooFinance.quote(cached.symbol.toUpperCase()), 'Yahoo quote');
        if (typeof quote.regularMarketPrice !== 'number') throw new Error('Yahoo returned no market price');
        const marketTime = quote.regularMarketTime ?? new Date();
        return {
          ...cached,
          symbol: quote.symbol,
          price: quote.regularMarketPrice,
          change: quote.regularMarketChange ?? cached.change,
          change_pct: quote.regularMarketChangePercent ?? cached.change_pct,
          high: quote.regularMarketDayHigh ?? cached.high,
          low: quote.regularMarketDayLow ?? cached.low,
          open: quote.regularMarketOpen ?? cached.open,
          prev_close: quote.regularMarketPreviousClose ?? cached.prev_close,
          source: 'yahoo',
          updated_at: marketTime.toISOString(),
          stale: false,
        };
      } catch (refreshError) {
        return {
          ...cached,
          stale: true,
          refresh_error: refreshError instanceof Error ? refreshError.message : 'Yahoo refresh failed',
        };
      }
    }),
  );
  return NextResponse.json({ quotes: refreshed, refreshed_at: new Date().toISOString() });
}

function rangeToMs(range: string): number {
  switch (range) {
    case '1d':
      return 24 * 60 * 60_000;
    case '5d':
      return 5 * 24 * 60 * 60_000;
    case '1mo':
      return 31 * 24 * 60 * 60_000;
    case '3mo':
      return 93 * 24 * 60 * 60_000;
    default:
      return 5 * 24 * 60 * 60_000;
  }
}

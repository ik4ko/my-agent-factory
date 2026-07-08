import { NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';
import { getAdminClient } from '@/lib/supabase/admin';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

/** GET /api/market/quotes[?symbol=AAPL]
 *  - No `symbol`: the loop-worker's Finnhub REST-poll cache (Supabase `quotes`
 *    table). Read-only; the dashboard also gets these live via Supabase
 *    Realtime, this route just backs the initial load.
 *  - `?symbol=`: a live single-symbol quote straight from Yahoo Finance,
 *    used by the Trading Room chart to drive its price line. */
export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get('symbol');

  if (symbol) {
    try {
      const quote = await yahooFinance.quote(symbol.toUpperCase());
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
  return NextResponse.json({ quotes: data ?? [] });
}

import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase/admin';

/** GET /api/market/quotes — the loop-worker's Finnhub REST-poll cache.
 *  Read-only; the dashboard also gets these live via Supabase Realtime on
 *  the `quotes` table, this route just backs the initial load. */
export async function GET() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getAdminClient() as any;
  const { data, error } = await db.from('quotes').select('*').order('symbol', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ quotes: data ?? [] });
}

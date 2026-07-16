import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const SymbolSchema = z.object({
  symbol: z.string().trim().min(1).max(16),
});

function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase();
}

function missingWatchlistTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /ticker_watchlist/i.test(message) && (/schema cache/i.test(message) || /does not exist/i.test(message) || /could not find the table/i.test(message));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export async function GET() {
  const { data, error } = await db()
    .from('ticker_watchlist')
    .select('symbol,is_active,updated_at')
    .eq('is_active', true)
    .order('updated_at', { ascending: true });

  if (error) {
    return NextResponse.json(
      {
        symbols: [],
        error:
          error.message ??
          'watchlist unavailable: unable to read ticker_watchlist in this environment',
      },
      { status: 200 },
    );
  }

  return NextResponse.json({ symbols: (data ?? []).map((row: { symbol: string }) => row.symbol.toUpperCase()) });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = SymbolSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid symbol' }, { status: 400 });
  }

  const symbol = normalizeSymbol(parsed.data.symbol);
  const { error } = await db()
    .from('ticker_watchlist')
    .upsert(
      {
        symbol,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'symbol' },
  );

  if (error) {
    if (missingWatchlistTable(error)) {
      return NextResponse.json(
        { error: 'watchlist unavailable: ticker_watchlist table is missing in this environment' },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message ?? 'watchlist upsert failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, symbol });
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = SymbolSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid symbol' }, { status: 400 });
  }

  const symbol = normalizeSymbol(parsed.data.symbol);
  const { error } = await db()
    .from('ticker_watchlist')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('symbol', symbol);

  if (error) {
    if (missingWatchlistTable(error)) {
      return NextResponse.json(
        { error: 'watchlist unavailable: ticker_watchlist table is missing in this environment' },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message ?? 'watchlist remove failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, symbol });
}

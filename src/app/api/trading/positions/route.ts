import { NextResponse } from 'next/server';
import { getMarketContext } from '@/lib/market/fetcher';
import { getAdminClient } from '@/lib/supabase/admin';
import { DirectAdapter } from '@/lib/execution/direct-adapter';
import type { Position } from '@/lib/execution/types';

export const dynamic = 'force-dynamic';

type OrderLedgerRow = {
  symbol: string;
  side: 'buy' | 'sell' | null;
  qty: number | null;
  notional: number | null;
  fill_price: number | null;
};

function resolveFillPrice(row: OrderLedgerRow): number | null {
  const explicit = Number(row.fill_price);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const qty = Number(row.qty);
  const notional = Number(row.notional);
  if (Number.isFinite(qty) && qty > 0 && Number.isFinite(notional) && notional > 0) {
    return notional / qty;
  }

  return null;
}

async function readPositionsFromLedger(): Promise<Position[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getAdminClient() as any;
  const { data, error } = await db
    .from('orders')
    .select('symbol, side, qty, notional, fill_price, status, created_at')
    .eq('status', 'filled')
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(error.message ?? 'orders ledger read failed');
  }

  const lots = new Map<string, { qty: number; buyQty: number; buyCost: number }>();
  for (const row of (data ?? []) as OrderLedgerRow[]) {
    const symbol = String(row.symbol ?? '').trim().toUpperCase();
    const qty = Number(row.qty);
    if (!symbol || !Number.isFinite(qty) || qty <= 0) continue;

    const fillPrice = resolveFillPrice(row);
    const lot = lots.get(symbol) ?? { qty: 0, buyQty: 0, buyCost: 0 };
    if (row.side === 'buy') {
      lot.qty += qty;
      lot.buyQty += qty;
      if (fillPrice !== null) lot.buyCost += qty * fillPrice;
    } else if (row.side === 'sell') {
      lot.qty -= qty;
    }
    lots.set(symbol, lot);
  }

  const prices = new Map<string, number>();
  await Promise.all(
    [...lots.entries()]
      .filter(([, lot]) => lot.qty > 0)
      .map(async ([symbol]) => {
        try {
          const ctx = await getMarketContext(symbol);
          if (Number.isFinite(ctx.price) && ctx.price > 0) {
            prices.set(symbol, ctx.price);
          }
        } catch {
          // If live market data is briefly unavailable, fall back to cost basis below.
        }
      }),
  );

  return [...lots.entries()]
    .map(([symbol, lot]) => {
      if (lot.qty <= 0) return null;
      const avgCost = lot.buyQty > 0 ? lot.buyCost / lot.buyQty : 0;
      const price = prices.get(symbol) ?? avgCost;
      return {
        symbol,
        qty: lot.qty,
        avgCost,
        marketValue: lot.qty * price,
      } satisfies Position;
    })
    .filter((position): position is Position => position !== null)
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/**
 * GET /api/trading/positions
 *
 * Read-only dashboard helper for watchlist ordering. It asks the local
 * Robinhood sidecar for current holdings first; if that sidecar is offline, it
 * falls back to the existing order ledger so the watchlist can still sort
 * owned symbols without collapsing the room into an offline warning.
 */
export async function GET() {
  const adapter = new DirectAdapter();

  try {
    const ready = await adapter.isReady();
    if (ready) {
      const positions = await adapter.getPositions();
      return NextResponse.json({ positions, source: 'sidecar', ready: true });
    }

    const positions = await readPositionsFromLedger();
    return NextResponse.json({ positions, source: 'orders-ledger', ready: true });
  } catch (err) {
    try {
      const positions = await readPositionsFromLedger();
      return NextResponse.json({ positions, source: 'orders-ledger', ready: true });
    } catch (ledgerErr) {
      return NextResponse.json({
        positions: [],
        source: 'sidecar',
        ready: false,
        error:
          ledgerErr instanceof Error
            ? ledgerErr.message
            : err instanceof Error
              ? err.message
              : 'positions unavailable',
      });
    }
  }
}

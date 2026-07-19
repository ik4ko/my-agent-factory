import { NextResponse } from 'next/server';
import { getMarketContext } from '@/lib/market/fetcher';
import { getAdminClient } from '@/lib/supabase/admin';
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
 * Read-only simulation positions derived solely from the paper order ledger.
 */
export async function GET() {
  try {
    const positions = await readPositionsFromLedger();
    return NextResponse.json({ positions, source: 'orders-ledger', ready: true });
  } catch (err) {
    return NextResponse.json({ positions: [], source: 'orders-ledger', ready: false, error: err instanceof Error ? err.message : 'positions unavailable' });
  }
}

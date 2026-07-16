import { NextResponse } from 'next/server';
import { DirectAdapter } from '@/lib/execution/direct-adapter';

export const dynamic = 'force-dynamic';

/**
 * GET /api/trading/positions
 *
 * Read-only dashboard helper for watchlist ordering. It only asks the local
 * Robinhood sidecar for current holdings; it never places, stages, or cancels
 * orders. If the sidecar is offline, the UI falls back to an unowned watchlist.
 */
export async function GET() {
  const adapter = new DirectAdapter();

  try {
    const ready = await adapter.isReady();
    if (!ready) return NextResponse.json({ positions: [], source: 'sidecar', ready: false });

    const positions = await adapter.getPositions();
    return NextResponse.json({ positions, source: 'sidecar', ready: true });
  } catch (err) {
    return NextResponse.json({
      positions: [],
      source: 'sidecar',
      ready: false,
      error: err instanceof Error ? err.message : 'positions unavailable',
    });
  }
}

import { NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';
import { getActiveWatchlist, runWatchlistSweep } from '@/lib/engine/orchestrator';

/**
 * POST /api/orchestrator/watchlist-sweep — fire one multi-ticker sweep.
 *
 * Responds immediately with the symbols accepted for this pulse; the sweep
 * runs via after(). Use `limit` for split-execution on constrained runtimes:
 * a daily cron with limit=1 rotates fairly through the watchlist (the
 * rotation cursor is `ticker_watchlist.updated_at`, stored in the DB).
 */

const SweepSchema = z.object({
  simulate: z.boolean().optional().default(true),
  trigger: z.enum(['manual', 'autonomous']).optional().default('manual'),
  limit: z.number().int().min(1).max(20).optional().default(10),
});

export async function POST(req: NextRequest) {
  let body: unknown = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = SweepSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  let symbols: string[];
  try {
    symbols = await getActiveWatchlist(parsed.data.limit);
  } catch (err) {
    return NextResponse.json(
      { error: `Watchlist unreadable: ${String(err).slice(0, 160)}` },
      { status: 500 },
    );
  }

  after(async () => {
    await runWatchlistSweep(parsed.data);
  });

  return NextResponse.json({
    accepted: true,
    simulate: parsed.data.simulate,
    trigger: parsed.data.trigger,
    symbols,
  });
}

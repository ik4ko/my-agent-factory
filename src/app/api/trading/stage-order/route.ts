import { NextRequest, NextResponse } from 'next/server';
import { StageOrderInputSchema } from '@/lib/types/trading.types';
import { buildStagedOrder, persistStagedOrder } from '@/lib/trading/stage';
import { getActivePortfolioBalance } from '@/lib/market/portfolio';

/**
 * POST /api/trading/stage-order — stage (never execute) an options order.
 *
 * The server ignores any client-supplied sizing and RECOMPUTES it:
 * expectancy must be > 0 and the position fraction is half-Kelly hard-capped
 * at 2% of paper equity (`clampPositionFraction` is the single choke point;
 * the staged_orders table additionally check-constrains kelly_fraction ≤ 0.02
 * and expectancy > 0 at the database layer). Rows land as PENDING and await
 * human approval. No brokerage SDKs exist in this codebase.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = StageOrderInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { pipeline_id, source, ...params } = parsed.data;
  // Sizing allocates against the live portfolio balance — clients cannot
  // supply an equity base any more than they can supply a size.
  const equityUsd = await getActivePortfolioBalance();
  const result = buildStagedOrder(params, {
    pipelineId: pipeline_id ?? null,
    source: source ?? 'RESEARCH',
    equityUsd,
  });

  if (!result.staged) {
    // Constraint rejection (E ≤ 0 or no positive Kelly edge) — not an error,
    // but nothing gets staged.
    return NextResponse.json({ staged: null, reason: result.reason }, { status: 422 });
  }

  try {
    await persistStagedOrder(result.staged);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to persist staged order: ${String(err).slice(0, 160)}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ staged: result.staged });
}

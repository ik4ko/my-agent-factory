import { NextResponse } from 'next/server';
import { selectAdapter } from '@/lib/execution/select-adapter';

/** GET /api/execution/portfolio — cash/equity/positions from whichever
 *  adapter is currently live (Direct/Bridge/DryRun). Read-only. */
export async function GET() {
  try {
    const adapter = await selectAdapter();
    const [portfolio, positions] = await Promise.all([adapter.getPortfolio(), adapter.getPositions()]);
    return NextResponse.json({ adapter: adapter.name, portfolio, positions });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'portfolio fetch failed' }, { status: 500 });
  }
}

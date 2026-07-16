import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getOptionsFlowThresholds, getRecentOptionsFlowAlerts, scanOptionsFlow } from '@/lib/trading/options-flow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PostSchema = z.object({
  action: z.enum(['scan', 'simulate']).optional().default('scan'),
});

export async function GET(req: NextRequest) {
  try {
    const limit = Number(req.nextUrl.searchParams.get('limit') ?? 20);
    const [alerts, thresholds] = await Promise.all([
      getRecentOptionsFlowAlerts(Number.isFinite(limit) ? limit : 20),
      Promise.resolve(getOptionsFlowThresholds()),
    ]);
    return NextResponse.json({ thresholds, alerts });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'options flow read failed', alerts: [] },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const parsed = PostSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'invalid options flow request' }, { status: 400 });
  }

  const result = await scanOptionsFlow({ simulate: parsed.data.action === 'simulate' });
  return NextResponse.json(result);
}


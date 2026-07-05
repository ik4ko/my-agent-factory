import { NextRequest, NextResponse } from 'next/server';
import { tick, dispatchEvents } from '@/lib/loops/engine';
import { timingSafeEqualStr } from '@/lib/auth/session';

// Lightweight heartbeat backup only — see scripts/loop-worker.mts for the
// always-on process this exists to back up. Vercel Cron can't hold state or
// tick sub-minute, so treat this as a safety net for when the worker isn't
// running, not the primary driver.
//
// Same CRON_SECRET auth pattern as /api/orchestrator/cron: middleware exempts
// this exact path and the check happens here so an unset secret fails closed.
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const header = req.headers.get('x-cron-secret') ?? undefined;
  const provided = bearer ?? header;
  return typeof provided === 'string' && timingSafeEqualStr(provided, secret);
}

async function pulse(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const events = await dispatchEvents();
    const ticked = await tick();
    return NextResponse.json({ ok: true, events, ticked, at: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Loop tick failed' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return pulse(req);
}
export async function POST(req: NextRequest) {
  return pulse(req);
}

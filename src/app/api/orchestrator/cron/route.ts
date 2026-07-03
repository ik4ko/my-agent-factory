import { NextRequest, NextResponse } from 'next/server';
import { triageTick } from '@/lib/agents/orchestrator';
import { clearStaleLocks } from '@/lib/agents/reaper';
import { timingSafeEqualStr } from '@/lib/auth/session';

// Automated platform pulse. Vercel Cron cannot present the operator session
// cookie, so this route authorizes on CRON_SECRET instead (Bearer token or
// x-cron-secret header). Middleware exempts this exact path (see PUBLIC_PATHS)
// and defers the check here so an unset secret fails closed.
//
// Fallback trigger only: reaps stale locks, then runs one triage sweep so the
// ecosystem keeps rolling with no operator on the dashboard. Heavy LLM
// execution stays off this request — dispatches run through the normal
// after()-backed tick path, not here.
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const header = req.headers.get('x-cron-secret') ?? undefined;
  const provided = bearer ?? header;
  return typeof provided === 'string' && timingSafeEqualStr(provided, secret);
}

async function pulse(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const reaped = await clearStaleLocks();
    const triage = await triageTick();
    return NextResponse.json({
      ok: true,
      reaped: reaped.recycled,
      scanned: triage.scanned,
      locked: triage.locked,
      halted: triage.halted,
      at: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Cron pulse failed' },
      { status: 500 }
    );
  }
}

// Vercel Cron issues GET; POST accepted for manual/external triggers.
export async function GET(req: NextRequest) {
  return pulse(req);
}
export async function POST(req: NextRequest) {
  return pulse(req);
}

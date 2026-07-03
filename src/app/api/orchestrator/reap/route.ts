import { NextResponse } from 'next/server';
import { clearStaleLocks } from '@/lib/agents/reaper';

// Manual/cron trigger for the stale-lock reaper. Auth-gated by middleware
// (session cookie), so an external cron must send the cookie — but this is a
// backstop only: triageTick() already reaps silently before every sweep.
async function reap() {
  try {
    const result = await clearStaleLocks();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Reap failed' },
      { status: 500 }
    );
  }
}

export async function POST() {
  return reap();
}

export async function GET() {
  return reap();
}

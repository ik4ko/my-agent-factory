import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { setKillSwitch, verifyOperatorPin } from '@/lib/control/risk-actions';
import { rateLimited } from '@/lib/control/rate-limit';

// Kill switch — engaged:true trips it (cancel-all + no new orders until
// released); engaged:false releases it. Defaults to true so a bare
// { pin } body from a panic tap always trips, never accidentally releases.
const Schema = z.object({ pin: z.string(), engaged: z.boolean().optional().default(true), actor: z.string().max(40).optional() });

export async function POST(req: NextRequest) {
  // Generous limit — kill must never be the thing that blocks a genuine
  // panic tap. This only exists to blunt a truly runaway automated caller.
  if (rateLimited('control:kill', 30)) return NextResponse.json({ error: 'rate limited — try again shortly' }, { status: 429 });

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'expected { pin, engaged? }' }, { status: 400 });

  if (!verifyOperatorPin(parsed.data.pin)) {
    await hermesLog('warn', '[CONTROL] kill-switch action rejected — invalid PIN');
    return NextResponse.json({ error: 'invalid PIN' }, { status: 403 });
  }

  const result = await setKillSwitch(parsed.data.engaged, parsed.data.actor ?? 'dashboard');
  return NextResponse.json({ ok: true, kill_switch: parsed.data.engaged, ...result });
}

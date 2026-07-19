import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { setArmed, verifyOperatorPin } from '@/lib/control/risk-actions';
import { rateLimited } from '@/lib/control/rate-limit';

// Simulation arm/disarm — flips the legacy-named risk_state.trading_enabled
// field. The PIN is defense-in-depth on top of the authenticated session.
const Schema = z.object({ pin: z.string(), enabled: z.boolean(), actor: z.string().max(40).optional() });

export async function POST(req: NextRequest) {
  if (rateLimited('control:arm', 5)) return NextResponse.json({ error: 'rate limited — try again shortly' }, { status: 429 });

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'expected { pin, enabled }' }, { status: 400 });

  if (!verifyOperatorPin(parsed.data.pin)) {
    await hermesLog('warn', '[CONTROL] arm rejected — invalid PIN');
    return NextResponse.json({ error: 'invalid PIN' }, { status: 403 });
  }

  const result = await setArmed(parsed.data.enabled, parsed.data.actor ?? 'dashboard');
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json({ ok: true, trading_enabled: parsed.data.enabled });
}

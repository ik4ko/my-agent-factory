import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { setArmed, verifyOperatorPin } from '@/lib/control/risk-actions';

// Master arm/disarm — flips risk_state.trading_enabled. Session-authed by
// middleware; the PIN below is defense-in-depth on top of that (a phone can
// be unlocked while still holding a valid session cookie).
const Schema = z.object({ pin: z.string(), enabled: z.boolean(), actor: z.string().max(40).optional() });

export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'expected { pin, enabled }' }, { status: 400 });

  if (!verifyOperatorPin(parsed.data.pin)) {
    await hermesLog('warn', '[CONTROL] arm rejected — invalid PIN');
    return NextResponse.json({ error: 'invalid PIN' }, { status: 403 });
  }

  await setArmed(parsed.data.enabled, parsed.data.actor ?? 'dashboard');
  return NextResponse.json({ ok: true, trading_enabled: parsed.data.enabled });
}

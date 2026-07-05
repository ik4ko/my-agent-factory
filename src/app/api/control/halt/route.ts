import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { setHalted, verifyOperatorPin } from '@/lib/control/risk-actions';

const Schema = z.object({
  pin: z.string(),
  halted: z.boolean(),
  reason: z.string().max(300).optional(),
  actor: z.string().max(40).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'expected { pin, halted, reason? }' }, { status: 400 });

  if (!verifyOperatorPin(parsed.data.pin)) {
    await hermesLog('warn', '[CONTROL] halt action rejected — invalid PIN');
    return NextResponse.json({ error: 'invalid PIN' }, { status: 403 });
  }

  await setHalted(parsed.data.halted, parsed.data.reason ?? null, parsed.data.actor ?? 'dashboard');
  return NextResponse.json({ ok: true, halted: parsed.data.halted });
}

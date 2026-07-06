import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parseCommand, runCommand } from '@/lib/comms/command';
import { rateLimited } from '@/lib/control/rate-limit';

// Session-authed (middleware) dashboard SMS simulator. Treats the logged-in
// operator as the allowlisted sender — it drives the EXACT SAME command core
// Twilio will call in /api/phone/sms once configured; nothing here is a
// separate mock implementation.
const Schema = z.object({ text: z.string().trim().min(1).max(500) });

export async function POST(req: NextRequest) {
  if (rateLimited('comms:simulate', 30)) return NextResponse.json({ error: 'rate limited — try again shortly' }, { status: 429 });

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'expected { text }' }, { status: 400 });

  const cmd = parseCommand(parsed.data.text);
  const result = await runCommand(cmd, { actor: 'dashboard-simulator' });
  return NextResponse.json(result);
}

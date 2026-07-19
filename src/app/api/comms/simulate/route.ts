import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parseCommand, runCommand } from '@/lib/comms/command';
import { rateLimited } from '@/lib/control/rate-limit';

// Session-authenticated dashboard command simulator. It drives the same
// deterministic command core without exposing a phone webhook.
const Schema = z.object({ text: z.string().trim().min(1).max(500) });

export async function POST(req: NextRequest) {
  if (rateLimited('comms:simulate', 30)) return NextResponse.json({ error: 'rate limited — try again shortly' }, { status: 429 });

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'expected { text }' }, { status: 400 });

  const cmd = parseCommand(parsed.data.text);
  const result = await runCommand(cmd, { actor: 'dashboard-simulator' });
  return NextResponse.json(result);
}

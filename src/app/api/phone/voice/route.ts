import { NextRequest, NextResponse } from 'next/server';
import { parseCommand, runCommand } from '@/lib/comms/command';

export const runtime = 'nodejs';

/**
 * Inbound voice webhook — maps a provider transcript to the same
 * parseCommand/runCommand core the SMS path and /dashboard/comms use.
 * Honest 501 until a voice provider is configured, same philosophy as
 * /api/phone/sms.
 *
 * The exact request/response envelope is provider-specific (Vapi and Retell
 * each have their own webhook shape and expect their own reply format) — this
 * accepts a few common field names now so the command-core mapping is real
 * and testable, but the precise contract should be finalized against
 * whichever provider's docs once VAPI_API_KEY/RETELL_API_KEY is actually set.
 */
export async function POST(req: NextRequest) {
  const vapiKey = process.env.VAPI_API_KEY?.trim();
  const retellKey = process.env.RETELL_API_KEY?.trim();
  if (!vapiKey && !retellKey) {
    return NextResponse.json({ error: 'Voice not configured — set VAPI_API_KEY or RETELL_API_KEY' }, { status: 501 });
  }

  const body = await req.json().catch(() => ({}));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = body as any;
  const transcript: string = b.transcript ?? b.text ?? b.message?.content ?? '';
  const caller: string = b.call?.customer?.number ?? b.from ?? 'unknown';

  const cmd = parseCommand(transcript);
  const result = await runCommand(cmd, { actor: `voice:${caller}` });
  return NextResponse.json({ reply: result.reply });
}

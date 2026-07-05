import { NextRequest, NextResponse } from 'next/server';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { parseCommand, runCommand } from '@/lib/comms/command';
import { validateTwilioSignature } from '@/lib/comms/twilio-signature';

export const runtime = 'nodejs';

function twiml(message: string): NextResponse {
  const escaped = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`, {
    headers: { 'Content-Type': 'text/xml' },
  });
}

/**
 * Inbound Twilio SMS webhook — a real shell today, honest about being
 * unconfigured rather than faking success. The command core it calls
 * (parseCommand/runCommand) is the exact same one /dashboard/comms already
 * exercises, so the ONLY thing a Twilio account unlocks here is the
 * signature check + the physical inbound pipe.
 */
export async function POST(req: NextRequest) {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const number = process.env.TWILIO_NUMBER?.trim();
  const operatorPhone = process.env.OPERATOR_PHONE?.trim();

  if (!sid || !token || !number) {
    return NextResponse.json({ error: 'Twilio not configured — set TWILIO_ACCOUNT_SID/AUTH_TOKEN/NUMBER' }, { status: 501 });
  }

  const rawBody = await req.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody));
  const signature = req.headers.get('x-twilio-signature') ?? '';

  if (!validateTwilioSignature(req.url, params, signature, token)) {
    await hermesLog('warn', '[SMS] inbound rejected — bad Twilio signature');
    return NextResponse.json({ error: 'invalid signature' }, { status: 403 });
  }

  const from = params.From ?? '';
  if (!operatorPhone || from !== operatorPhone) {
    await hermesLog('warn', `[SMS] inbound rejected — sender ${from || '(none)'} not on the allowlist`);
    return twiml('not authorized');
  }

  const cmd = parseCommand(params.Body ?? '');
  const result = await runCommand(cmd, { actor: `sms:${from}` });
  return twiml(result.reply);
}

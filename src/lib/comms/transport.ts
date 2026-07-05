// Outbound message transport abstraction. Every notify call in the codebase
// (arm/kill/fill/critical-regime) routes through notify()/activeTransport()
// so that adding real Twilio later is a config change, not a refactor.
//
// LocalTransport is the default and is a REAL delivery, not a no-op stub:
// it persists to outbound_messages (status='local') and Realtime streams it
// straight into /dashboard/comms — inspectable and testable today with zero
// external accounts.
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { getAdminClient } from '@/lib/supabase/admin';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

// PostgrestBuilder only implements `.then()` (it's a thenable, not a real
// Promise) — `.catch()` is not a method on it, so best-effort audit updates
// must go through a real try/catch instead of chaining `.catch(() => {})`.
async function safeUpdate(id: string, patch: Record<string, unknown>): Promise<void> {
  try {
    await db().from('outbound_messages').update(patch).eq('id', id);
  } catch {
    /* audit is best-effort */
  }
}

// Shared runaway-loop guard across whichever transport is active.
const SENT_TIMES: number[] = [];
const MAX_PER_HOUR = 30;
function rateOk(): boolean {
  const now = Date.now();
  while (SENT_TIMES.length && SENT_TIMES[0] < now - 3_600_000) SENT_TIMES.shift();
  if (SENT_TIMES.length >= MAX_PER_HOUR) return false;
  SENT_TIMES.push(now);
  return true;
}

export type MessageKind = 'alert' | 'reply' | 'summary';

export interface MessageTransport {
  name: 'local' | 'twilio';
  send(to: string, body: string, kind?: MessageKind): Promise<void>;
}

class LocalTransport implements MessageTransport {
  name = 'local' as const;

  async send(to: string, body: string, kind: MessageKind = 'alert'): Promise<void> {
    if (!rateOk()) {
      await hermesLog('warn', `[COMMS] local send dropped — rate cap reached (max ${MAX_PER_HOUR}/hour)`);
      return;
    }
    try {
      await db().from('outbound_messages').insert({
        channel: 'sms',
        recipient: to,
        subject: kind,
        body: body.slice(0, 1500),
        agent: 'system',
        status: 'local',
        sent_at: new Date().toISOString(),
      });
    } catch (err) {
      await hermesLog('error', `[COMMS] local delivery audit failed: ${String(err).replace(/\s+/g, ' ').slice(0, 160)}`);
    }
    await hermesLog('info', `[COMMS→local] to ${to} — "${body.slice(0, 120)}"`);
  }
}

class TwilioTransport implements MessageTransport {
  name = 'twilio' as const;

  async send(to: string, body: string): Promise<void> {
    const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
    const token = process.env.TWILIO_AUTH_TOKEN?.trim();
    const from = process.env.TWILIO_NUMBER?.trim();
    const trimmedBody = body.slice(0, 1500);

    let auditId: string | null = null;
    try {
      const { data } = await db()
        .from('outbound_messages')
        .insert({ channel: 'sms', recipient: to, subject: '', body: trimmedBody, agent: 'system', status: 'sending' })
        .select('id')
        .single();
      auditId = data?.id ?? null;
    } catch {
      /* audit is best-effort */
    }

    if (!sid || !token || !from) {
      if (auditId) await safeUpdate(auditId, { status: 'failed', error: 'Twilio not configured' });
      await hermesLog('error', '[COMMS→twilio] send attempted with missing TWILIO_* env');
      return;
    }
    if (!rateOk()) {
      if (auditId) await safeUpdate(auditId, { status: 'failed', error: 'rate cap' });
      return;
    }

    try {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: to, From: from, Body: trimmedBody }),
        signal: AbortSignal.timeout(10_000),
      });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error(`Twilio ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sidOut = (json as any)?.sid as string | undefined;
      if (auditId) await safeUpdate(auditId, { status: 'sent', provider_id: sidOut ?? null, sent_at: new Date().toISOString() });
      await hermesLog('success', `[COMMS→twilio] sent — "${trimmedBody.slice(0, 100)}"`);
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 200);
      if (auditId) await safeUpdate(auditId, { status: 'failed', error: msg });
      await hermesLog('error', `[COMMS→twilio] send FAILED — ${msg.slice(0, 120)}`);
    }
  }
}

const local = new LocalTransport();
const twilio = new TwilioTransport();

/** Twilio auto-selected the instant all three creds are present — nothing
 *  else in the codebase needs to change when that happens. */
export function activeTransport(): MessageTransport {
  const configured = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_NUMBER;
  return configured ? twilio : local;
}

/** Convenience wrapper every notify call site should use — resolves the
 *  operator's number (or a local-console placeholder) and sends through
 *  whichever transport is active. */
export async function notify(body: string, kind: MessageKind = 'alert'): Promise<void> {
  const to = process.env.OPERATOR_PHONE?.trim() || 'operator';
  await activeTransport().send(to, body, kind);
}

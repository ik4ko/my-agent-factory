// Outbound message transport abstraction. Every notify call in the codebase
// (arm/kill/fill/critical-regime) routes through notify()/activeTransport()
// This is the dashboard-local notification ledger. Telegram uses its own
// allowlisted watcher and Bot API transport; no SMS/voice transport exists.
//
// LocalTransport is the default and is a REAL delivery, not a no-op stub:
// it persists to outbound_messages (status='local') and Realtime streams it
// straight into /api/comms/simulate (headless) — inspectable and testable today with zero
// external accounts.
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { getAdminClient } from '@/lib/supabase/admin';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

// PostgrestBuilder only implements `.then()` (it's a thenable, not a real
// Promise) — `.catch()` is not a method on it, so best-effort audit updates
// must go through a real try/catch instead of chaining `.catch(() => {})`.
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
  name: 'local';
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
        channel: 'local',
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

const local = new LocalTransport();

export function activeTransport(): MessageTransport {
  return local;
}

/** Convenience wrapper every notify call site should use — resolves the
 *  dashboard-local audit stream. Telegram notifications are sent by the
 *  independently authenticated Telegram watcher. */
export async function notify(body: string, kind: MessageKind = 'alert'): Promise<void> {
  await activeTransport().send('operator', body, kind);
}

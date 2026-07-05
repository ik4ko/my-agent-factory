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

export interface EmailInput {
  to: string;
  subject: string;
  body: string;
  agent?: string;
}
export interface EmailResult {
  ok: boolean;
  id?: string;
  staged?: boolean;
  error?: string;
}

// Runaway-loop / manipulated-agent guard: cap sends per rolling hour.
const SENT_TIMES: number[] = [];
const MAX_PER_HOUR = 20;
function rateOk(): boolean {
  const now = Date.now();
  while (SENT_TIMES.length && SENT_TIMES[0] < now - 3_600_000) SENT_TIMES.shift();
  if (SENT_TIMES.length >= MAX_PER_HOUR) return false;
  SENT_TIMES.push(now);
  return true;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Send an email AS the operator's own Gmail via SMTP (App Password).
 * Env: GMAIL_USER, GMAIL_APP_PASSWORD.  Optional COMMS_REQUIRE_APPROVAL=true
 * stages the message (status='staged') instead of sending — flip it on for a
 * human-approval gate without any code change.
 *
 * Every attempt is written to public.outbound_messages for audit, and logged
 * to the dashboard terminal. `nodemailer` is imported dynamically so the app
 * still builds if it isn't installed yet (run: npm install nodemailer).
 */
export async function sendEmail(input: EmailInput): Promise<EmailResult> {
  const user = process.env.GMAIL_USER?.trim();
  const pass = process.env.GMAIL_APP_PASSWORD?.trim();
  const to = input.to?.trim();
  const subject = (input.subject ?? '').trim();
  const body = input.body ?? '';
  const agent = input.agent ?? 'system';

  if (!to || !EMAIL_RE.test(to)) return { ok: false, error: `invalid recipient: ${to || '(empty)'}` };
  if (!user || !pass) return { ok: false, error: 'GMAIL_USER / GMAIL_APP_PASSWORD not set in .env.local' };

  // Audit row first, so even a crash mid-send leaves a trace.
  let auditId: string | null = null;
  try {
    const { data } = await db()
      .from('outbound_messages')
      .insert({ channel: 'email', recipient: to, subject, body, agent, status: 'sending' })
      .select('id')
      .single();
    auditId = data?.id ?? null;
  } catch {
    /* audit is best-effort — never blocks a send */
  }

  // Optional human-approval gate.
  if (process.env.COMMS_REQUIRE_APPROVAL === 'true') {
    if (auditId) await safeUpdate(auditId, { status: 'staged' });
    await hermesLog('warn', `[EMAIL] STAGED for approval — to ${to} "${subject.slice(0, 60)}" (by ${agent})`);
    return { ok: true, staged: true, id: auditId ?? undefined };
  }

  if (!rateOk()) {
    if (auditId) await safeUpdate(auditId, { status: 'failed', error: 'rate cap' });
    return { ok: false, error: `rate cap reached (max ${MAX_PER_HOUR} emails/hour)` };
  }

  try {
    // nodemailer is installed — import it directly so Turbopack bundles it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nm: any = await import('nodemailer');
    const createTransport = nm?.createTransport ?? nm?.default?.createTransport;
    if (!createTransport) throw new Error('nodemailer not installed — run: npm install nodemailer');

    const transport = createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user, pass },
    });
    const info = await transport.sendMail({ from: user, to, subject: subject || '(no subject)', text: body });

    if (auditId) {
      await safeUpdate(auditId, { status: 'sent', provider_id: info?.messageId ?? null, sent_at: new Date().toISOString() });
    }
    await hermesLog('success', `[EMAIL] sent to ${to} — "${subject.slice(0, 60)}" (by ${agent})`);
    return { ok: true, id: auditId ?? undefined };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 200);
    if (auditId) await safeUpdate(auditId, { status: 'failed', error: msg });
    await hermesLog('error', `[EMAIL] send FAILED to ${to} — ${msg.slice(0, 120)}`);
    return { ok: false, error: msg };
  }
}

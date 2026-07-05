'use client';

import { useState } from 'react';
import { Send, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';

type Status =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; staged?: boolean }
  | { kind: 'error'; message: string };

/**
 * Operator-driven email composer. Posts to /api/comms/email, which sends AS the
 * operator's own Gmail (App Password) and writes an audit row. This is a manual
 * send — the user clicks Send — separate from agents sending autonomously.
 */
export function EmailComposer() {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const canSend =
    status.kind !== 'sending' &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim()) &&
    body.trim().length > 0;

  async function send() {
    if (!canSend) return;
    setStatus({ kind: 'sending' });
    try {
      const res = await fetch('/api/comms/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: to.trim(), subject: subject.trim(), body, agent: 'operator' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        setStatus({ kind: 'error', message: data?.error || `Send failed (${res.status})` });
        return;
      }
      setStatus({ kind: 'sent', staged: Boolean(data?.staged) });
      setSubject('');
      setBody('');
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : 'Network error' });
    }
  }

  const field =
    'w-full rounded-md border border-border bg-[#0A0A0A] px-3 py-2 text-sm text-foreground ' +
    'placeholder:text-muted-foreground/50 outline-none transition-colors focus:border-neon-orange/60';

  return (
    <div className="max-w-2xl space-y-3">
      <div className="flex items-center gap-2">
        <input
          type="email"
          value={to}
          onChange={(e) => { setTo(e.target.value); if (status.kind !== 'idle') setStatus({ kind: 'idle' }); }}
          placeholder="recipient@example.com"
          className={field}
          autoComplete="off"
        />
      </div>
      <input
        type="text"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Subject"
        className={field}
        autoComplete="off"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write your message…"
        rows={8}
        className={field + ' resize-y font-mono leading-relaxed'}
      />

      <div className="flex items-center justify-between gap-3">
        <div className="min-h-5 text-xs">
          {status.kind === 'sent' && (
            <span className="inline-flex items-center gap-1.5 text-neon-green">
              <CheckCircle2 className="size-3.5" />
              {status.staged ? 'Staged for approval' : 'Sent from your Gmail'}
            </span>
          )}
          {status.kind === 'error' && (
            <span className="inline-flex items-center gap-1.5 text-neon-red">
              <AlertTriangle className="size-3.5" />
              {status.message}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          className={
            'inline-flex items-center gap-2 rounded-md px-4 py-2 text-xs font-semibold uppercase tracking-wide transition-all ' +
            (canSend
              ? 'bg-neon-orange/15 text-neon-orange border border-neon-orange/40 hover:bg-neon-orange/25'
              : 'cursor-not-allowed border border-border bg-surface-2 text-muted-foreground/50')
          }
        >
          {status.kind === 'sending' ? (
            <><Loader2 className="size-3.5 animate-spin" /> Sending</>
          ) : (
            <><Send className="size-3.5" /> Send</>
          )}
        </button>
      </div>
    </div>
  );
}

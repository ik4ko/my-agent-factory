'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, RotateCcw, ShieldOff } from 'lucide-react';

/**
 * Bridge health — the website side of the lead pipeline, made visible.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * A lead that never reached this CRM used to be invisible here. The website
 * recorded the failure faithfully in `lead_sync_outbox` and nobody ever saw
 * it, because that table lives in a different Supabase project and this
 * dashboard only reads its own. "The queue looks empty" and "delivery is
 * broken" looked identical to the operator. That is the failure mode this
 * panel removes.
 *
 * Presentational only: the data arrives as a prop from the inbox's existing
 * load(), so no second polling effect is introduced.
 *
 * No lead PII crosses the boundary — a stuck delivery is identified by its
 * submission id and acted on with Retry. See lib/crm/health.ts on the website.
 */

export type BridgeHealthData = {
  configured: boolean;
  note?: string;
  error?: string;
  outbox?: {
    pending: number;
    processing: number;
    delivered: number;
    retryable: number;
    dead: number;
    oldestPendingAt: string | null;
  };
  notifications?: {
    emailSent: number;
    emailFailed: number;
    smsSkipped: number;
    smsSent: number;
    smsFailed: number;
  };
  recentFailures?: Array<{
    id: string;
    websiteSubmissionId: string;
    remoteLeadId: string | null;
    category: string;
    message: string;
    attempts: number;
    maxAttempts: number;
    lastAttemptAt: string | null;
    nextAttemptAt: string | null;
    state: 'retryable' | 'dead';
  }>;
  smsConfigured?: boolean;
  generatedAt?: string;
};

const CATEGORY_LABEL: Record<string, string> = {
  deployment_protection: 'Blocked by deployment protection',
  rejected_by_crm: 'Rejected by the CRM',
  crm_unavailable: 'CRM server error',
  network_or_timeout: 'Could not reach the CRM',
  not_configured: 'Bridge not configured',
  unknown: 'Unknown failure',
};

function when(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function BridgeHealth({
  health,
  onRetry,
}: {
  health: BridgeHealthData | null;
  onRetry: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  if (!health) return null;

  if (!health.configured) {
    return (
      <Shell>
        <p className="text-[11px] text-muted-foreground">
          {health.note ?? 'Bridge health is not configured.'}
        </p>
      </Shell>
    );
  }

  if (health.error) {
    return (
      <Shell>
        <p className="flex items-center gap-1.5 text-[11px] text-red-300">
          <AlertTriangle className="size-3.5 shrink-0" />
          {health.error}
        </p>
      </Shell>
    );
  }

  const outbox = health.outbox;
  const notes = health.notifications;
  const failures = health.recentFailures ?? [];
  const stuck = (outbox?.dead ?? 0) + (outbox?.pending ?? 0) + (outbox?.processing ?? 0);
  const healthy = stuck === 0 && (notes?.emailFailed ?? 0) === 0 && failures.length === 0;

  return (
    <Shell>
      {healthy ? (
        <p className="flex items-center gap-1.5 text-[11px] text-emerald-300">
          <CheckCircle2 className="size-3.5 shrink-0" />
          Every lead the website has captured reached this dashboard, and every advisor alert
          was sent.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="Delivered" value={outbox?.delivered ?? 0} />
        <Stat label="Waiting" value={(outbox?.pending ?? 0) + (outbox?.processing ?? 0)} tone={stuck ? 'warn' : undefined} />
        <Stat label="Gave up" value={outbox?.dead ?? 0} tone={(outbox?.dead ?? 0) > 0 ? 'bad' : undefined} />
        <Stat label="Email sent" value={notes?.emailSent ?? 0} />
        <Stat label="Email failed" value={notes?.emailFailed ?? 0} tone={(notes?.emailFailed ?? 0) > 0 ? 'bad' : undefined} />
      </div>

      {outbox?.oldestPendingAt ? (
        <p className="flex items-center gap-1.5 text-[11px] text-amber-200">
          <Clock className="size-3.5 shrink-0" />
          Oldest lead still waiting to sync: {when(outbox.oldestPendingAt)}.
        </p>
      ) : null}

      {/*
        SMS being skipped is the correct state, not a fault. Saying so stops an
        operator reading a column of "skipped" as something being broken.
      */}
      {!health.smsConfigured && (notes?.smsSkipped ?? 0) > 0 ? (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <ShieldOff className="size-3.5 shrink-0" />
          {notes?.smsSkipped} SMS alert{(notes?.smsSkipped ?? 0) === 1 ? '' : 's'} skipped —
          Twilio is not configured. This is expected, not a failure.
        </p>
      ) : null}

      {failures.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Deliveries needing attention
          </p>
          {failures.map((f) => (
            <div
              key={f.id}
              className="rounded border border-border bg-surface-2 p-2 text-[11px]"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span
                  className={
                    f.state === 'dead'
                      ? 'font-medium text-red-300'
                      : 'font-medium text-amber-200'
                  }
                >
                  {CATEGORY_LABEL[f.category] ?? f.category}
                  {f.state === 'dead' ? ' · stopped retrying' : ' · will retry'}
                </span>
                <button
                  type="button"
                  disabled={busy === f.id}
                  onClick={async () => {
                    setBusy(f.id);
                    try {
                      await onRetry(f.id);
                    } finally {
                      setBusy(null);
                    }
                  }}
                  className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-[11px] transition hover:border-primary/60 disabled:opacity-50"
                >
                  <RotateCcw className="size-3" />
                  {busy === f.id ? 'Retrying…' : 'Retry now'}
                </button>
              </div>
              <p className="mt-1 text-muted-foreground">{f.message}</p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                submission {f.websiteSubmissionId.slice(0, 8)}…
                {f.remoteLeadId ? ` · crm ${f.remoteLeadId.slice(0, 8)}…` : ''} · attempt{' '}
                {f.attempts}/{f.maxAttempts} · last tried {when(f.lastAttemptAt)}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section
      aria-label="Bridge health"
      className="space-y-2 rounded border border-border bg-surface-1 p-2.5"
    >
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Bridge health · website → CRM
      </p>
      {children}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warn' | 'bad' }) {
  const toneClass =
    tone === 'bad' ? 'text-red-300' : tone === 'warn' ? 'text-amber-200' : 'text-foreground';
  return (
    <div className="rounded border border-border bg-surface-2 px-2 py-1.5">
      <p className={`text-sm font-semibold tabular-nums ${toneClass}`}>{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { ArrowLeft, CalendarClock, CircleAlert, MessageSquare, ShieldCheck, StickyNote } from 'lucide-react';
import { PanelChrome } from '@/components/deck';
import { MedicareEmpty, MedicareStatus, formatCurrency } from './medicare-primitives';
import { CoverageReview } from './coverage-review';
import { useOperatorFetch } from './use-operator-fetch';

/**
 * One client, everything about them, and where each fact came from.
 *
 * The provenance column is the part that matters: a plan code typed in by hand
 * and one read off the CMS record months ago look identical in a table, and
 * only one of them should be trusted when deciding what to tell a member.
 *
 * The MBI arrives masked from the API and there is no control here to reveal
 * it, because the browser has no legitimate use for the raw value.
 */

type ClientRecord = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  date_of_birth: string | null;
  physical_address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  masked_mbi: string | null;
  tags: string[];
  last_verified_at: string | null;
  next_review_at: string | null;
  created_at: string;
};

type Policy = {
  id: string;
  plan_name: string;
  plan_id: string | null;
  contract_pbp: string | null;
  effective_date: string | null;
  monthly_premium: number | null;
  status: string;
  last_verified_at: string | null;
};

type Snapshot = {
  id: string;
  source: string;
  source_detail: string;
  observed_at: string;
  verification_status: string;
  contract_pbp: string | null;
  plan_name: string | null;
  carrier_name: string | null;
};

type Note = { id: string; note: string; created_at: string; created_by: string | null };
type Communication = { id: string; type: string; content: string; direction: string; timestamp: string };
type Task = { id: string; kind: string; title: string; detail: string; priority: string; status: string; due_at: string | null };
type OriginLead = {
  id: string;
  source_page: string;
  consent_reply: boolean;
  consent_sms: boolean;
  consent_marketing: boolean;
  submitted_at: string;
};

type Payload = {
  client: ClientRecord;
  policies: Policy[];
  notes: Note[];
  communications: Communication[];
  snapshots: Snapshot[];
  diffs: { id: string; status: string }[];
  tasks: Task[];
  originLeads: OriginLead[];
  error?: string;
};

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' {
  const normalized = status.toLowerCase();
  if (['active', 'appointed', 'approved'].includes(normalized)) return 'success';
  if (['pending', 'in_review'].includes(normalized)) return 'warning';
  if (['expired', 'terminated', 'cancelled', 'lost'].includes(normalized)) return 'danger';
  return 'neutral';
}

export function ClientDetail({ clientId }: { clientId: string }) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data, loading, error: loadError, reload } = useOperatorFetch<Payload>(
    `/api/medicare-crm/clients/${clientId}`,
    'Could not load this client',
  );
  const error = saveError ?? loadError;

  /*
    useCallback, not a bare function declared during render: reading the clock
    with Date.now() in the render scope makes the component impure, and the
    React Compiler rejects it. Inside a callback the read happens when the
    operator clicks, which is also when "now" actually means anything.
  */
  const scheduleReview = useCallback(
    async (days: number) => {
      setSaving(true);
      setSaveError(null);
      try {
        const next = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
        const res = await fetch(`/api/medicare-crm/clients/${clientId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ next_review_at: next }),
        });
        if (!res.ok) throw new Error('Could not update the review date');
        reload();
      } catch (caught) {
        setSaveError(caught instanceof Error ? caught.message : 'Could not update the review date');
      } finally {
        setSaving(false);
      }
    },
    [clientId, reload],
  );

  if (loading && !data) {
    return <div className="p-3 text-xs text-muted-foreground">Loading client…</div>;
  }

  if (error && !data) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">
        <CircleAlert className="mt-0.5 size-4 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  if (!data) return null;

  const { client, policies, notes, communications, snapshots, tasks, originLeads } = data;
  const pendingDiffs = data.diffs.filter((d) => d.status === 'pending').length;

  return (
    <div className="space-y-3 pb-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Link
            href="/dashboard/rooms/medicare/clients"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3" /> Back to clients
          </Link>
          <div className="mt-1 text-lg font-semibold">
            {client.first_name} {client.last_name}
          </div>
          <div className="text-xs text-muted-foreground">
            {[client.city, client.state, client.zip].filter(Boolean).join(', ') || 'No address on file'}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {client.tags.map((tag) => (
            <MedicareStatus key={tag} tone="neutral">
              {tag}
            </MedicareStatus>
          ))}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {pendingDiffs > 0 && (
        <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-xs">
          <span className="font-semibold">{pendingDiffs} coverage change{pendingDiffs === 1 ? '' : 's'} awaiting your approval.</span>{' '}
          Nothing has been written to this record.
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-[1.4fr_0.6fr]">
        <div className="space-y-3">
          <PanelChrome title="IDENTITY" bodyClassName="grid gap-2 sm:grid-cols-2">
            <Field label="Phone" value={client.phone ?? '—'} />
            <Field label="Email" value={client.email ?? '—'} />
            <Field label="Date of birth" value={formatDate(client.date_of_birth)} />
            <Field label="MBI (masked)" value={client.masked_mbi ?? 'Not recorded'} mono />
            <Field label="Address" value={client.physical_address ?? '—'} />
            <Field label="In book since" value={formatDate(client.created_at)} />
          </PanelChrome>

          <PanelChrome
            title="POLICIES"
            headerRight={<span className="text-[10px] text-muted-foreground">{policies.length} on file</span>}
            bodyClassName="space-y-2"
          >
            {policies.length === 0 ? (
              <MedicareEmpty message="No policies attached to this client." />
            ) : (
              policies.map((policy) => (
                <div key={policy.id} className="rounded border border-border/50 p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium">{policy.plan_name}</span>
                    <MedicareStatus tone={statusTone(policy.status)}>{policy.status}</MedicareStatus>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="font-mono">{policy.contract_pbp ?? policy.plan_id ?? 'No plan code'}</span>
                    <span>Effective {formatDate(policy.effective_date)}</span>
                    <span>
                      {policy.monthly_premium ? `${formatCurrency(Number(policy.monthly_premium))}/mo` : 'Premium not recorded'}
                    </span>
                    {/* Verification age is the trust signal for everything above it. */}
                    <span>
                      {policy.last_verified_at
                        ? `Verified ${formatDate(policy.last_verified_at)}`
                        : 'Never verified'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </PanelChrome>

          <CoverageReview clientId={clientId} />

          <PanelChrome
            title="COVERAGE HISTORY"
            headerRight={<span className="text-[10px] text-muted-foreground">Provenance</span>}
            bodyClassName="p-0"
          >
            {snapshots.length === 0 ? (
              <div className="p-3">
                <MedicareEmpty message="No verification history. Snapshots appear here once a source reports on this member." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-left text-[11px]">
                  <thead className="bg-surface-2/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Observed</th>
                      <th className="px-3 py-2">Source</th>
                      <th className="px-3 py-2">Result</th>
                      <th className="px-3 py-2">Plan code</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshots.map((snapshot) => (
                      <tr key={snapshot.id} className="border-t border-border/40">
                        <td className="px-3 py-2">{formatDate(snapshot.observed_at)}</td>
                        <td className="px-3 py-2">{snapshot.source_detail || snapshot.source}</td>
                        <td className="px-3 py-2">{snapshot.verification_status.replace(/_/g, ' ')}</td>
                        <td className="px-3 py-2 font-mono">{snapshot.contract_pbp ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </PanelChrome>
        </div>

        <div className="space-y-3">
          <PanelChrome title="REVIEW SCHEDULE" bodyClassName="space-y-2">
            <Field label="Last verified" value={formatDate(client.last_verified_at)} />
            <Field label="Next review" value={formatDate(client.next_review_at)} />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {[30, 90, 180].map((days) => (
                <button
                  key={days}
                  type="button"
                  disabled={saving}
                  onClick={() => void scheduleReview(days)}
                  className="inline-flex h-7 items-center gap-1 rounded border border-border bg-surface-2 px-2 text-[11px] transition hover:border-primary/60 disabled:opacity-50"
                >
                  <CalendarClock className="size-3" /> +{days}d
                </button>
              ))}
            </div>
          </PanelChrome>

          {originLeads.length > 0 && (
            <PanelChrome title="CONSENT ON RECORD" bodyClassName="space-y-2">
              {originLeads.map((lead) => (
                <div key={lead.id} className="space-y-1.5 text-[11px]">
                  <div className="text-muted-foreground">
                    From {lead.source_page || 'website'} on {formatDate(lead.submitted_at)}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <MedicareStatus tone={lead.consent_reply ? 'success' : 'danger'}>
                      reply {lead.consent_reply ? 'yes' : 'no'}
                    </MedicareStatus>
                    <MedicareStatus tone={lead.consent_sms ? 'success' : 'danger'}>
                      sms {lead.consent_sms ? 'yes' : 'no'}
                    </MedicareStatus>
                    <MedicareStatus tone={lead.consent_marketing ? 'success' : 'danger'}>
                      marketing {lead.consent_marketing ? 'yes' : 'no'}
                    </MedicareStatus>
                  </div>
                  {/* Stated plainly: consent is per-channel and never inferred. */}
                  {!lead.consent_sms && (
                    <div className="text-muted-foreground">No SMS consent — do not text this person.</div>
                  )}
                </div>
              ))}
            </PanelChrome>
          )}

          <PanelChrome
            title="OPEN TASKS"
            headerRight={<span className="text-[10px] text-muted-foreground">{tasks.length}</span>}
            bodyClassName="space-y-2"
          >
            {tasks.length === 0 ? (
              <div className="text-xs text-muted-foreground">No open tasks.</div>
            ) : (
              tasks.map((task) => (
                <div key={task.id} className="rounded border border-border/50 p-2 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{task.title}</span>
                    <MedicareStatus tone={task.priority === 'urgent' ? 'danger' : 'warning'}>
                      {task.priority}
                    </MedicareStatus>
                  </div>
                  <div className="mt-1 text-muted-foreground">{task.detail}</div>
                </div>
              ))
            )}
          </PanelChrome>

          <PanelChrome
            title="COMMUNICATIONS"
            headerRight={<MessageSquare className="size-3.5 text-muted-foreground" />}
            bodyClassName="space-y-2"
          >
            {communications.length === 0 ? (
              <div className="text-xs text-muted-foreground">No communication history recorded.</div>
            ) : (
              communications.slice(0, 8).map((item) => (
                <div key={item.id} className="rounded border border-border/50 p-2 text-[11px]">
                  <div className="flex justify-between gap-2">
                    <MedicareStatus tone="neutral">
                      {item.type} · {item.direction}
                    </MedicareStatus>
                    <span className="text-muted-foreground">{formatDate(item.timestamp)}</span>
                  </div>
                  <div className="mt-1 text-muted-foreground">{item.content}</div>
                </div>
              ))
            )}
          </PanelChrome>

          <PanelChrome
            title="NOTES"
            headerRight={<StickyNote className="size-3.5 text-muted-foreground" />}
            bodyClassName="space-y-2"
          >
            {notes.length === 0 ? (
              <div className="text-xs text-muted-foreground">No notes on file.</div>
            ) : (
              notes.slice(0, 8).map((note) => (
                <div key={note.id} className="rounded border border-border/50 p-2 text-[11px]">
                  <div className="text-muted-foreground">{formatDate(note.created_at)}</div>
                  <div className="mt-1">{note.note}</div>
                </div>
              ))
            )}
          </PanelChrome>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded border border-border/50 bg-surface-2/20 p-2 text-[11px] text-muted-foreground">
        <ShieldCheck className="size-3.5" />
        Client-facing messaging stays disabled until consent, opt-out handling, and templates are verified.
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded border border-border/50 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 break-words text-xs ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}

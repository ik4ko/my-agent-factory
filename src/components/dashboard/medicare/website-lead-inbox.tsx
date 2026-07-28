'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Inbox, RefreshCcw, UserPlus } from 'lucide-react';
import { PanelChrome } from '@/components/deck';
import { MedicareEmpty, MedicareStatus } from './medicare-primitives';
import { BridgeHealth, type BridgeHealthData } from './bridge-health';
import {
  AnimatedList,
  CountUp,
  SkeletonRow,
  StatusTransition,
  isOverdue,
  STATUS_LABEL,
  type LeadStatus,
  type TimelineEvent,
} from '@/components/medicare-crm/lead-inbox-primitives';

/**
 * Website lead inbox, mounted in the Medicare room.
 *
 * Uses the dashboard's own PanelChrome + design tokens rather than the
 * standalone styling in components/medicare-crm/, so it reads as part of the
 * room instead of a bolted-on widget. The React Bits primitives (CountUp,
 * AnimatedList stagger, ShinyText skeleton, status crossfade) are shared.
 *
 * The organising idea is the "needs a reply" queue, oldest first. A lead
 * inbox whose default sort is newest-first is how enquiries quietly rot at
 * the bottom of a list.
 *
 * Data comes from /api/website-leads, which is operator-session gated by the
 * same `requireMedicareOperator` guard as the rest of this room. No public
 * visitor can reach it.
 */

type WebsiteLead = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  zip: string | null;
  preferred_contact: 'phone' | 'text' | 'email';
  topic: string | null;
  message: string;
  source_page: string;
  attribution: Record<string, string>;
  consent_reply: boolean;
  consent_sms: boolean;
  consent_marketing: boolean;
  status: LeadStatus;
  assigned_to: string | null;
  first_response_at: string | null;
  last_contact_at: string | null;
  next_action_at: string | null;
  do_not_contact: boolean;
  converted_client_id: string | null;
  submitted_at: string;
};

const inputClass =
  'h-8 rounded border border-border bg-surface-2 px-2 text-xs text-foreground outline-none focus:border-primary/60';
const buttonClass =
  'inline-flex h-8 items-center justify-center gap-1.5 rounded border border-border bg-surface-2 px-2.5 text-xs text-foreground transition hover:border-primary/60 disabled:cursor-not-allowed disabled:opacity-50';

/** Hours before an unanswered lead is flagged. Configurable, not hard-coded. */
const SLA_HOURS = 4;

export function WebsiteLeadInbox() {
  const [leads, setLeads] = useState<WebsiteLead[]>([]);
  const [events, setEvents] = useState<Record<string, TimelineEvent[]>>({});
  const [loading, setLoading] = useState(true);
  const [migrationApplied, setMigrationApplied] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [health, setHealth] = useState<BridgeHealthData | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      /*
        Both reads happen in this one loader on purpose. Bridge health could
        have owned its own effect, but that would mean a second polling
        lifecycle for data an operator only ever reads next to the queue —
        and one more instance of the setState-in-effect pattern the linter
        already flags here. One fetch pass, one refresh button.

        Health is settled independently: the website being unreachable must
        never blank out the lead list, which comes from this project.
      */
      const [leadsRes, healthRes] = await Promise.allSettled([
        fetch('/api/website-leads', { cache: 'no-store' }),
        fetch('/api/website-leads/health', { cache: 'no-store' }),
      ]);

      if (healthRes.status === 'fulfilled') {
        setHealth(await healthRes.value.json().catch(() => null));
      } else {
        setHealth({ configured: true, error: 'Could not reach the bridge health endpoint.' });
      }

      if (leadsRes.status === 'rejected') throw new Error('Request failed');
      const res = leadsRes.value;
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? 'Request failed');
      setLeads(body.leads ?? []);
      setEvents(body.events ?? {});
      setMigrationApplied(body.migrationApplied !== false);
      setNote(body.note ?? null);
    } catch (error) {
      setNote(String(error).slice(0, 160));
    } finally {
      setLoading(false);
    }
  }, []);

  /** Re-drive one stuck delivery, then refresh so the result is visible. */
  const retryDelivery = useCallback(
    async (id: string) => {
      await fetch('/api/website-leads/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      await load();
    },
    [load],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const patch = useCallback(
    async (payload: Record<string, unknown>) => {
      await fetch('/api/website-leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      await load();
    },
    [load],
  );

  const convert = useCallback(
    async (id: string) => {
      await fetch('/api/website-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      await load();
    },
    [load],
  );

  const { needsReply, inProgress, stats } = useMemo(() => {
    const open = leads.filter(
      (lead) => !['closed', 'enrolled', 'do_not_contact'].includes(lead.status),
    );
    const needs = open
      .filter((lead) => !lead.first_response_at)
      .sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));

    return {
      needsReply: needs,
      inProgress: open.filter((lead) => lead.first_response_at),
      stats: {
        needsReply: needs.length,
        overdue: needs.filter((l) => isOverdue(l.submitted_at, null, SLA_HOURS)).length,
        unassigned: open.filter((l) => !l.assigned_to).length,
        alertFailed: leads.filter((l) => l.status === 'notification_failed').length,
      },
    };
  }, [leads]);

  return (
    <PanelChrome
      title="WEBSITE LEAD INBOX"
      headerRight={
        <button type="button" className={buttonClass} onClick={() => void load()}>
          <RefreshCcw className="size-3.5" /> Refresh
        </button>
      }
      bodyClassName="space-y-3"
    >
      {/*
        Local tiles rather than <MedicareMetric>: that primitive types `value`
        as a string, and these need to render the CountUp element. Styling is
        copied from it so the row still reads as native to the room.
      */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Needs a reply" value={stats.needsReply} />
        <Metric label="Overdue" value={stats.overdue} tone="warning" />
        <Metric label="No owner" value={stats.unassigned} />
        <Metric label="Alert failed" value={stats.alertFailed} tone="danger" />
      </div>

      <BridgeHealth health={health} onRetry={retryDelivery} />

      {!migrationApplied ? (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] text-amber-200">
          <strong>Table not created yet.</strong> Apply{' '}
          <code>supabase/migrations/20260727_website_leads.sql</code> to this project, then
          refresh. Website leads are queued safely on the website until then.
        </div>
      ) : null}

      {note && migrationApplied ? (
        <div className="text-[11px] text-muted-foreground">{note}</div>
      ) : null}

      {loading ? (
        <div className="space-y-2">
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : (
        <>
          <Section title="Needs a reply — oldest first">
            {needsReply.length === 0 ? (
              <MedicareEmpty message="No website enquiry is waiting on a first reply." />
            ) : (
              <AnimatedList className="space-y-2">
                {needsReply.map((lead) => (
                  <LeadRow
                    key={lead.id}
                    lead={lead}
                    events={events[lead.id] ?? []}
                    onPatch={patch}
                    onConvert={convert}
                  />
                ))}
              </AnimatedList>
            )}
          </Section>

          {inProgress.length > 0 ? (
            <Section title="In progress">
              <AnimatedList className="space-y-2">
                {inProgress.map((lead) => (
                  <LeadRow
                    key={lead.id}
                    lead={lead}
                    events={events[lead.id] ?? []}
                    onPatch={patch}
                    onConvert={convert}
                  />
                ))}
              </AnimatedList>
            </Section>
          ) : null}
        </>
      )}
    </PanelChrome>
  );
}

function Metric({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'warning' | 'danger';
}) {
  const toneClass =
    tone === 'warning' ? 'text-amber-300' : tone === 'danger' ? 'text-rose-300' : 'text-foreground';
  return (
    <div className="rounded-md border border-border/60 bg-surface-2/40 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className={`mt-2 text-2xl font-semibold tracking-tight ${toneClass}`}>
        <CountUp value={value} />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

function LeadRow({
  lead,
  events,
  onPatch,
  onConvert,
}: {
  lead: WebsiteLead;
  events: TimelineEvent[];
  onPatch: (payload: Record<string, unknown>) => Promise<void>;
  onConvert: (id: string) => Promise<void>;
}) {
  const [noteDraft, setNoteDraft] = useState('');
  const overdue = isOverdue(lead.submitted_at, lead.first_response_at, SLA_HOURS);
  const name = `${lead.first_name} ${lead.last_name}`.trim() || 'Unnamed enquiry';

  return (
    <article
      className={`rounded border p-3 ${overdue ? 'border-rose-500/50 bg-rose-500/5' : 'border-border/50 bg-surface-2/20'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-foreground">{name}</div>
          <div className="text-[11px] text-muted-foreground">
            {new Date(lead.submitted_at).toLocaleString()} · {lead.source_page} ·{' '}
            {lead.email ?? lead.phone ?? 'no contact detail'}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {overdue ? <MedicareStatus tone="danger">Overdue</MedicareStatus> : null}
          <StatusTransition status={lead.status} />
        </div>
      </div>

      {/*
        Consent is on the row, not behind a click. Whether this person may be
        texted is the most consequential fact before acting, and it must never
        be guessed from the "prefers" field sitting next to it.
      */}
      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
        <Chip on={lead.consent_reply}>Reply OK</Chip>
        <Chip on={lead.consent_sms}>SMS OK</Chip>
        <Chip on={lead.consent_marketing}>Marketing OK</Chip>
        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-muted-foreground">
          Prefers {lead.preferred_contact}
        </span>
        {lead.do_not_contact ? (
          <span className="rounded bg-rose-500/20 px-1.5 py-0.5 font-semibold text-rose-200">
            DO NOT CONTACT
          </span>
        ) : null}
      </div>

      {lead.message ? (
        <p className="mt-2 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">
          {lead.message}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <select
          className={inputClass}
          value={lead.status}
          aria-label="Lead status"
          onChange={(event) => void onPatch({ id: lead.id, status: event.target.value })}
        >
          {(Object.keys(STATUS_LABEL) as LeadStatus[]).map((status) => (
            <option key={status} value={status}>
              {STATUS_LABEL[status]}
            </option>
          ))}
        </select>

        <input
          className={inputClass}
          placeholder="Assign to…"
          defaultValue={lead.assigned_to ?? ''}
          aria-label="Assign lead"
          onBlur={(event) =>
            void onPatch({ id: lead.id, assigned_to: event.target.value || null })
          }
        />

        <input
          type="date"
          className={inputClass}
          aria-label="Next action date"
          defaultValue={lead.next_action_at?.slice(0, 10) ?? ''}
          onChange={(event) =>
            void onPatch({ id: lead.id, next_action_at: event.target.value || null })
          }
        />

        {(['phone', 'text', 'email'] as const).map((channel) => (
          <button
            key={channel}
            type="button"
            className={buttonClass}
            onClick={() => void onPatch({ id: lead.id, record_contact: channel })}
          >
            Logged {channel}
          </button>
        ))}

        <button
          type="button"
          className={buttonClass}
          onClick={() => void onPatch({ id: lead.id, do_not_contact: true })}
        >
          Do not contact
        </button>

        {lead.converted_client_id ? (
          <span className="text-[11px] text-emerald-300">Converted to client</span>
        ) : (
          <button
            type="button"
            className={buttonClass}
            onClick={() => void onConvert(lead.id)}
            title="Creates a CRM client record. Never happens automatically."
          >
            <UserPlus className="size-3.5" /> Convert to client
          </button>
        )}
      </div>

      <div className="mt-2 flex gap-1.5">
        <input
          className={`${inputClass} flex-1`}
          placeholder="Internal note…"
          value={noteDraft}
          aria-label="Internal note"
          onChange={(event) => setNoteDraft(event.target.value)}
        />
        <button
          type="button"
          className={buttonClass}
          disabled={!noteDraft.trim()}
          onClick={() => {
            void onPatch({ id: lead.id, note: noteDraft.trim() });
            setNoteDraft('');
          }}
        >
          Add note
        </button>
      </div>

      {events.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-muted-foreground">
            Timeline ({events.length})
          </summary>
          <ol className="mt-2 space-y-1.5 border-l border-border/50 pl-3">
            {events.map((event) => (
              <li key={event.id} className="text-[11px]">
                <span className="text-foreground">{event.event.replace(/_/g, ' ')}</span>{' '}
                <time className="text-muted-foreground" dateTime={event.created_at}>
                  {new Date(event.created_at).toLocaleString()}
                </time>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </article>
  );
}

function Chip({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 ${on ? 'bg-emerald-500/15 text-emerald-300' : 'bg-surface-2 text-muted-foreground line-through'}`}
    >
      {children}
    </span>
  );
}

export { Inbox };

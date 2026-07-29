'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CircleAlert,
  FileWarning,
  Inbox,
  RefreshCcw,
  ShieldAlert,
  SplitSquareHorizontal,
  type LucideIcon,
} from 'lucide-react';
import { PanelChrome } from '@/components/deck';
import { MedicareEmpty, MedicareStatus } from './medicare-primitives';
import type { QueueItem, QueueItemKind, QueuePriority } from '@/lib/medicare-crm/work-queue';
import { useOperatorFetch } from './use-operator-fetch';

/**
 * The Today view: one ordered list answering "what should I do next?".
 *
 * Ordering is decided on the server by buildWorkQueue() and rendered here
 * verbatim. That split is deliberate — the rules about what outranks what are
 * the part worth testing, and they are untestable once they live in a
 * component.
 *
 * Each row shows priority, age, source, status, owner and exactly one action.
 * The single-action rule is enforced by the QueueItem type rather than by
 * convention, so a row physically cannot grow a competing second button.
 */

type TodayResponse = {
  queue: QueueItem[];
  summary: Record<QueueItemKind, number>;
  counts: { totalClients: number; openItems: number };
  pendingMigrations: string[];
  generatedAt: string;
  error?: string;
};

const KIND_META: Record<QueueItemKind, { label: string; icon: LucideIcon }> = {
  new_lead: { label: 'New website leads', icon: Inbox },
  lead_uncontacted: { label: 'Awaiting follow-up', icon: Inbox },
  client_review_due: { label: 'Reviews due', icon: CalendarClock },
  coverage_change: { label: 'Coverage changes', icon: SplitSquareHorizontal },
  verification_blocked: { label: 'Verification blocked', icon: ShieldAlert },
  failed_job: { label: 'Failed jobs', icon: FileWarning },
  draft_communication: { label: 'Drafts to review', icon: AlertTriangle },
  compliance_action: { label: 'Needs your approval', icon: ShieldAlert },
};

const PRIORITY_TONE: Record<QueuePriority, 'danger' | 'warning' | 'neutral'> = {
  urgent: 'danger',
  high: 'warning',
  normal: 'neutral',
  low: 'neutral',
};

/** "3h" / "2d" — an age column is for scanning, not for precision. */
function formatAge(hours: number): string {
  if (hours < 1) return '<1h';
  if (hours < 48) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function TodayQueue() {
  const { data, loading, error, reload } = useOperatorFetch<TodayResponse>(
    '/api/medicare-crm/today',
    'Could not load the work queue',
  );
  const [filter, setFilter] = useState<QueueItemKind | 'all'>('all');

  const visible = useMemo(() => {
    if (!data) return [];
    return filter === 'all' ? data.queue : data.queue.filter((item) => item.kind === filter);
  }, [data, filter]);

  const urgentCount = data?.queue.filter((item) => item.priority === 'urgent').length ?? 0;

  return (
    <div className="space-y-3 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Today</div>
          <div className="mt-1 text-sm text-foreground/80">
            {loading && !data
              ? 'Loading the queue…'
              : data
                ? `${data.counts.openItems} open item${data.counts.openItems === 1 ? '' : 's'}${urgentCount ? ` · ${urgentCount} urgent` : ''}`
                : '—'}
          </div>
        </div>
        <button
          type="button"
          onClick={reload}
          disabled={loading}
          className="inline-flex h-8 items-center gap-1.5 rounded border border-border bg-surface-2 px-2.5 text-xs transition hover:border-primary/60 disabled:opacity-50"
        >
          <RefreshCcw className="size-3.5" /> Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/*
        A missing migration is stated plainly rather than shown as an empty
        queue. "Nothing to do" and "this section cannot load" look identical
        otherwise, and only one of them is safe to believe.
      */}
      {data && data.pendingMigrations.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="font-semibold uppercase tracking-wider">Queue is partially blind</div>
            <div className="mt-1">
              Some sources could not be read because their migration has not been applied:{' '}
              {data.pendingMigrations.join(', ')}. Items from those sources are missing from this queue.
            </div>
          </div>
        </div>
      )}

      {data && (
        <div className="flex flex-wrap gap-1.5">
          <FilterChip label="All" count={data.queue.length} active={filter === 'all'} onClick={() => setFilter('all')} />
          {(Object.keys(KIND_META) as QueueItemKind[])
            .filter((kind) => data.summary[kind] > 0)
            .map((kind) => (
              <FilterChip
                key={kind}
                label={KIND_META[kind].label}
                count={data.summary[kind]}
                active={filter === kind}
                onClick={() => setFilter(kind)}
              />
            ))}
        </div>
      )}

      <PanelChrome
        title="WORK QUEUE"
        headerRight={
          <span className="text-[10px] text-muted-foreground">
            {data ? `Generated ${formatWhen(data.generatedAt)}` : ''}
          </span>
        }
        bodyClassName="p-0"
      >
        {loading && !data ? (
          <div className="p-3 text-xs text-muted-foreground">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="p-3">
            <MedicareEmpty
              message={
                data && data.queue.length === 0
                  ? 'Nothing needs attention right now. New website leads, due reviews, and coverage changes will appear here.'
                  : 'No items in this category.'
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-border/40">
            {visible.map((item) => (
              <QueueRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </PanelChrome>
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition ${
        active
          ? 'border-primary/60 bg-primary/10 text-foreground'
          : 'border-border bg-surface-2 text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
      <span className="rounded-full bg-surface-1 px-1.5 text-[10px] tabular-nums">{count}</span>
    </button>
  );
}

function QueueRow({ item }: { item: QueueItem }) {
  const Icon = KIND_META[item.kind].icon;

  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5 transition hover:bg-surface-2/40">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-xs font-medium text-foreground">{item.title}</span>
          <MedicareStatus tone={PRIORITY_TONE[item.priority]}>{item.priority}</MedicareStatus>
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{item.subtitle}</div>
      </div>

      <dl className="flex shrink-0 items-center gap-4 text-[11px] text-muted-foreground">
        <div>
          <dt className="sr-only">Age</dt>
          <dd className="tabular-nums" title={`Last updated ${formatWhen(item.lastUpdated)}`}>
            {formatAge(item.ageHours)}
          </dd>
        </div>
        <div className="hidden sm:block">
          <dt className="sr-only">Source</dt>
          <dd className="max-w-32 truncate">{item.source}</dd>
        </div>
        <div className="hidden md:block">
          <dt className="sr-only">Status</dt>
          <dd className="max-w-32 truncate">{item.status}</dd>
        </div>
        <div className="hidden lg:block">
          <dt className="sr-only">Owner</dt>
          <dd>{item.owner ?? 'Unassigned'}</dd>
        </div>
      </dl>

      {/* Exactly one action. See the note on QueueItem.action. */}
      <Link
        href={item.action.href}
        className="shrink-0 rounded border border-border bg-surface-2 px-2.5 py-1 text-xs transition hover:border-primary/60"
      >
        {item.action.label}
      </Link>
    </li>
  );
}

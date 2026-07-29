'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, Check, CircleAlert, Flag, RefreshCcw, X } from 'lucide-react';
import { PanelChrome } from '@/components/deck';
import { MedicareEmpty, MedicareStatus } from './medicare-primitives';
import { useOperatorFetch } from './use-operator-fetch';

/**
 * Coverage review — current value beside incoming value, with provenance.
 *
 * The screen exists to make one question easy: should this proposed change be
 * written onto the book of business? So it shows what we hold, what the source
 * reported, where that came from, when it was observed, and how much the
 * system trusts it — then offers accept, reject, or flag.
 *
 * Nothing here applies automatically. Every button posts an explicit decision,
 * and the server records who decided what and when.
 */

type Diff = {
  id: string;
  client_id: string;
  policy_id: string | null;
  snapshot_id: string;
  target_table: string;
  target_field: string;
  current_value: string | null;
  incoming_value: string | null;
  source: string;
  observed_at: string;
  confidence: 'low' | 'medium' | 'high';
  status: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string;
};

type Client = { id: string; first_name: string | null; last_name: string | null; city: string | null; state: string | null };

type Snapshot = {
  id: string;
  source: string;
  source_detail: string;
  observed_at: string;
  verification_status: string;
  contract_pbp: string | null;
  plan_name: string | null;
  carrier_name: string | null;
  evidence_ref: string | null;
};

const CONFIDENCE_TONE = { high: 'success', medium: 'warning', low: 'neutral' } as const;

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

type CoverageResponse = {
  diffs: Diff[];
  clients: Client[];
  snapshots: Snapshot[];
  migrationApplied: boolean;
  note?: string;
};

export function CoverageReview({ clientId }: { clientId?: string }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  // Derived, not stored: the URL is the query. Changing either control
  // re-runs the fetch through the hook's dependency on it.
  const url = useMemo(() => {
    const params = new URLSearchParams({ status: showResolved ? 'all' : 'pending' });
    if (clientId) params.set('clientId', clientId);
    return `/api/medicare-crm/coverage?${params}`;
  }, [clientId, showResolved]);

  const { data, loading, error: loadError, reload } = useOperatorFetch<CoverageResponse>(
    url,
    'Could not load coverage reviews',
  );

  const diffs = useMemo(() => data?.diffs ?? [], [data]);
  const clientById = useMemo(
    () => new Map((data?.clients ?? []).map((c) => [c.id, c])),
    [data],
  );
  const snapshotById = useMemo(
    () => new Map((data?.snapshots ?? []).map((s) => [s.id, s])),
    [data],
  );
  const note = data?.migrationApplied === false ? data.note ?? null : null;
  const error = decisionError ?? loadError;

  async function decide(diff: Diff, decision: 'accept' | 'reject' | 'follow_up') {
    setBusyId(diff.id);
    setDecisionError(null);
    try {
      const res = await fetch('/api/medicare-crm/coverage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: diff.id, decision }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? 'Could not record that decision');
      reload();
    } catch (caught) {
      setDecisionError(caught instanceof Error ? caught.message : 'Could not record that decision');
    } finally {
      setBusyId(null);
    }
  }

  const pending = diffs.filter((d) => d.status === 'pending');

  return (
    <div className="space-y-3 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Coverage reviews</div>
          <div className="mt-1 text-sm text-foreground/80">
            Imported and verified data never overwrites a record on its own. Approve each change.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(event) => setShowResolved(event.target.checked)}
              className="size-3.5"
            />
            Show resolved
          </label>
          <button
            type="button"
            onClick={reload}
            disabled={loading}
            className="inline-flex h-8 items-center gap-1.5 rounded border border-border bg-surface-2 px-2.5 text-xs transition hover:border-primary/60 disabled:opacity-50"
          >
            <RefreshCcw className="size-3.5" /> Refresh
          </button>
        </div>
      </div>

      {(error || note) && (
        <div className="flex items-start gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <span>{error ?? note}</span>
        </div>
      )}

      <PanelChrome
        title="PENDING CHANGES"
        headerRight={<span className="text-[10px] text-muted-foreground">{pending.length} awaiting approval</span>}
        bodyClassName="space-y-2"
      >
        {loading && diffs.length === 0 ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : diffs.length === 0 ? (
          <MedicareEmpty message="No coverage changes are waiting. Verified results that match the record do not appear here." />
        ) : (
          diffs.map((diff) => (
            <DiffCard
              key={diff.id}
              diff={diff}
              client={clientById.get(diff.client_id)}
              snapshot={snapshotById.get(diff.snapshot_id)}
              busy={busyId === diff.id}
              onDecide={(decision) => void decide(diff, decision)}
            />
          ))
        )}
      </PanelChrome>
    </div>
  );
}

function DiffCard({
  diff,
  client,
  snapshot,
  busy,
  onDecide,
}: {
  diff: Diff;
  client?: Client;
  snapshot?: Snapshot;
  busy: boolean;
  onDecide: (decision: 'accept' | 'reject' | 'follow_up') => void;
}) {
  const name = client ? `${client.first_name ?? ''} ${client.last_name ?? ''}`.trim() : 'Unknown client';
  const resolved = diff.status !== 'pending';

  return (
    <div id={diff.id} className="rounded border border-border/60 bg-surface-2/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">{name}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {diff.target_table}.{diff.target_field}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <MedicareStatus tone={CONFIDENCE_TONE[diff.confidence]}>{diff.confidence} confidence</MedicareStatus>
          {resolved && <MedicareStatus tone="neutral">{diff.status}</MedicareStatus>}
        </div>
      </div>

      {/* Current beside incoming. The comparison is the whole point of the card. */}
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_1fr]">
        <div className="rounded border border-border/50 bg-surface-1/40 p-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Current (CRM)</div>
          <div className="mt-1 break-words font-mono text-xs text-foreground">{diff.current_value ?? '—'}</div>
        </div>
        <div className="hidden items-center justify-center sm:flex">
          <ArrowRight className="size-4 text-muted-foreground" aria-label="changes to" />
        </div>
        <div className="rounded border border-primary/40 bg-primary/5 p-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Incoming</div>
          <div className="mt-1 break-words font-mono text-xs text-foreground">{diff.incoming_value ?? '—'}</div>
        </div>
      </div>

      {/* Provenance: an operator cannot judge a value without knowing its source. */}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>Source: {snapshot?.source_detail || diff.source}</span>
        <span>Observed: {formatWhen(diff.observed_at)}</span>
        {snapshot && <span>Result: {snapshot.verification_status.replace(/_/g, ' ')}</span>}
        {snapshot?.carrier_name && <span>Carrier: {snapshot.carrier_name}</span>}
      </div>

      {resolved ? (
        <div className="mt-2 text-[11px] text-muted-foreground">
          {diff.status} by {diff.resolved_by ?? 'operator'} on {formatWhen(diff.resolved_at)}
          {diff.resolution_note && ` — ${diff.resolution_note}`}
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide('accept')}
            className="inline-flex h-8 items-center gap-1.5 rounded border border-emerald-400/40 bg-emerald-400/10 px-2.5 text-xs text-emerald-200 transition hover:bg-emerald-400/20 disabled:opacity-50"
          >
            <Check className="size-3.5" /> {busy ? 'Applying…' : 'Accept change'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide('reject')}
            className="inline-flex h-8 items-center gap-1.5 rounded border border-border bg-surface-2 px-2.5 text-xs transition hover:border-rose-400/50 disabled:opacity-50"
          >
            <X className="size-3.5" /> Reject
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide('follow_up')}
            className="inline-flex h-8 items-center gap-1.5 rounded border border-border bg-surface-2 px-2.5 text-xs transition hover:border-amber-400/50 disabled:opacity-50"
          >
            <Flag className="size-3.5" /> Mark for follow-up
          </button>
        </div>
      )}
    </div>
  );
}

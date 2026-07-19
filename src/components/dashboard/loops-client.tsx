'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, Pause, Play, Plus, Repeat, Square, Trash2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useLoopsQuery } from '@/hooks/use-loops-query';
import { useLoopRunsQuery } from '@/hooks/use-loop-runs-query';
import { useConnectionStore, type ChannelStatus } from '@/lib/realtime/connection-store';
import type { LoopKind, LoopRow, LoopRunRow, LoopStatus } from '@/lib/types/database.types';

const KIND_OPTIONS: LoopKind[] = ['monitor', 'research', 'build', 'trade', 'personal'];
const BRAIN_OPTIONS = ['claude', 'codex', 'hermes'] as const;

const STATUS_BADGE: Record<LoopStatus, 'success' | 'muted' | 'error'> = {
  armed: 'success',
  paused: 'muted',
  stopped: 'error',
};

/** Awaited mutation with a real error result — no fire-and-forget. */
async function loopRequest(path: string, init: RequestInit): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(path, init);
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: data.error ?? `request failed (${res.status})` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'network error' };
  }
}

function patchLoop(id: string, body: Record<string, unknown>) {
  return loopRequest(`/api/loops/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Re-render on an interval so relative times stay truthful (no frozen
 *  "5s ago" that is actually minutes old). */
function useNowTick(intervalMs = 10_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function relativeTime(iso: string | null, now: number): string {
  if (!iso) return 'never';
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function durationLabel(run: LoopRunRow): string | null {
  if (!run.finished_at) return null;
  const ms = new Date(run.finished_at).getTime() - new Date(run.started_at).getTime();
  if (ms < 0) return null;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Collapse the two loops-room channels into one truthful liveness chip. */
function liveness(channels: Record<string, ChannelStatus>): { label: string; tone: 'live' | 'warn' | 'down' } {
  const statuses = ['loops-changes', 'loop-runs-changes'].map((c) => channels[c]);
  if (statuses.every((s) => s === 'connected')) return { label: 'LIVE', tone: 'live' };
  if (statuses.some((s) => s === 'reconnecting' || s === 'closed')) return { label: 'RECONNECTING — data may be stale', tone: 'down' };
  return { label: 'CONNECTING', tone: 'warn' };
}

function CreateLoopForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<LoopKind>('monitor');
  const [objective, setObjective] = useState('');
  const [cadence, setCadence] = useState(30);
  const [brain, setBrain] = useState<(typeof BRAIN_OPTIONS)[number]>('claude');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim() || !objective.trim()) return;
    setBusy(true);
    setError(null);
    const result = await loopRequest('/api/loops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, kind, objective, cadence_seconds: cadence, brain }),
    });
    setBusy(false);
    if (!result.ok) {
      // Keep everything the operator typed — they fix and resubmit.
      setError(result.error ?? 'create failed');
      return;
    }
    setName('');
    setObjective('');
    setError(null);
    setOpen(false);
    onCreated();
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus /> New loop
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3">
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Loop name"
          className="h-8 flex-1 rounded border border-border bg-background px-2 text-sm"
        />
        <select value={kind} onChange={(e) => setKind(e.target.value as LoopKind)} className="h-8 rounded border border-border bg-background px-2 text-sm">
          {KIND_OPTIONS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <select value={brain} onChange={(e) => setBrain(e.target.value as (typeof BRAIN_OPTIONS)[number])} className="h-8 rounded border border-border bg-background px-2 text-sm">
          {BRAIN_OPTIONS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={objective}
        onChange={(e) => setObjective(e.target.value)}
        placeholder="Standing objective — what should this loop keep pursuing?"
        rows={2}
        className="rounded border border-border bg-background px-2 py-1.5 text-sm"
      />
      {error && (
        <p className="flex items-center gap-1.5 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
          <AlertTriangle className="size-3 shrink-0" /> {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground">Cadence (s)</label>
        <input
          type="number"
          min={5}
          value={cadence}
          onChange={(e) => setCadence(Number(e.target.value))}
          className="h-8 w-24 rounded border border-border bg-background px-2 text-sm"
        />
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={busy} onClick={submit}>
            {busy ? <Loader2 className="animate-spin" /> : null} Create (paused)
          </Button>
        </div>
      </div>
    </div>
  );
}

function LoopRowItem({ loop, now, onChanged }: { loop: LoopRow; now: number; onChanged: () => void }) {
  const [pending, setPending] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const act = async (label: string, body: Record<string, unknown>) => {
    setPending(label);
    setRowError(null);
    const result = await patchLoop(loop.id, body);
    setPending(null);
    if (!result.ok) setRowError(`${label} failed: ${result.error}`);
    else onChanged();
  };

  const remove = async () => {
    setPending('delete');
    setRowError(null);
    const result = await loopRequest(`/api/loops/${loop.id}`, { method: 'DELETE' });
    setPending(null);
    setConfirmingDelete(false);
    if (!result.ok) setRowError(`delete failed: ${result.error}`);
    else onChanged();
  };

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center gap-3">
        <Repeat className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{loop.name}</span>
            <Badge variant="outline">{loop.kind}</Badge>
            <Badge variant={STATUS_BADGE[loop.status]}>{loop.status}</Badge>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{loop.objective}</p>
          <p className="mt-0.5 font-terminal text-[10px] text-muted-foreground/60">
            cadence {loop.cadence_seconds ? `${loop.cadence_seconds}s` : 'event-only'} · last tick {relativeTime(loop.last_tick_at, now)} · brain {loop.brain}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {pending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label={`${pending} in progress`} />}
          <Button
            variant="ghost"
            size="icon-sm"
            title={loop.status === 'armed' ? 'Run now (schedules an immediate tick)' : 'Arm the loop first — Run now only works on armed loops'}
            disabled={loop.status !== 'armed' || pending !== null}
            onClick={() => act('run now', { run_now: true })}
          >
            <Zap className="text-neon-green" />
          </Button>
          <Button variant="ghost" size="icon-sm" title="Arm" disabled={loop.status === 'armed' || pending !== null} onClick={() => act('arm', { status: 'armed' })}>
            <Play className="text-neon-green" />
          </Button>
          <Button variant="ghost" size="icon-sm" title="Pause" disabled={loop.status === 'paused' || pending !== null} onClick={() => act('pause', { status: 'paused' })}>
            <Pause />
          </Button>
          <Button variant="ghost" size="icon-sm" title="Stop" disabled={loop.status === 'stopped' || pending !== null} onClick={() => act('stop', { status: 'stopped' })}>
            <Square className="text-destructive" />
          </Button>
          {confirmingDelete ? (
            <span className="flex items-center gap-1 rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5">
              <span className="text-[10px] text-destructive">delete + run history?</span>
              <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px] text-destructive" disabled={pending !== null} onClick={remove}>
                yes
              </Button>
              <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" disabled={pending !== null} onClick={() => setConfirmingDelete(false)}>
                no
              </Button>
            </span>
          ) : (
            <Button variant="ghost" size="icon-sm" title="Delete" disabled={pending !== null} onClick={() => setConfirmingDelete(true)}>
              <Trash2 className="text-destructive/70" />
            </Button>
          )}
        </div>
      </div>
      {rowError && (
        <p className="mt-2 flex items-center gap-1.5 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
          <AlertTriangle className="size-3 shrink-0" /> {rowError}
        </p>
      )}
    </div>
  );
}

function RunItem({ run, loopName, now }: { run: LoopRunRow; loopName: string; now: number }) {
  const [expanded, setExpanded] = useState(false);
  const duration = durationLabel(run);

  return (
    <div className="rounded-md border border-border p-2 text-xs">
      <button type="button" className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        <span className="flex min-w-0 items-center gap-1.5">
          {expanded ? <ChevronDown className="size-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3 shrink-0 text-muted-foreground" />}
          <span className="truncate font-medium text-foreground">{loopName}</span>
        </span>
        <Badge
          variant={run.status === 'completed' ? 'success' : run.status === 'failed' ? 'error' : 'muted'}
          className={cn(run.status === 'running' && 'animate-pulse')}
        >
          {run.status}
        </Badge>
      </button>
      <p className="mt-1 text-muted-foreground/80">
        {relativeTime(run.started_at, now)}
        {duration ? ` · took ${duration}` : run.status === 'running' ? ' · in progress' : ''}
      </p>
      {!expanded && run.decision && (
        <p className="mt-1 truncate font-terminal text-[10px] text-muted-foreground">{JSON.stringify(run.decision).slice(0, 140)}</p>
      )}
      {!expanded && run.error && <p className="mt-1 truncate text-[10px] text-destructive">{run.error}</p>}
      {expanded && (
        <div className="mt-2 flex flex-col gap-1.5 border-t border-border pt-2">
          <p className="font-terminal text-[10px] text-muted-foreground/60">
            started {new Date(run.started_at).toLocaleString()}
            {run.finished_at ? ` · finished ${new Date(run.finished_at).toLocaleString()}` : ''}
          </p>
          {run.error && <pre className="overflow-x-auto rounded bg-destructive/10 p-1.5 text-[10px] text-destructive">{run.error}</pre>}
          {(['trigger', 'decision', 'actions', 'result'] as const).map((field) =>
            run[field] ? (
              <div key={field}>
                <p className="font-terminal text-[9px] uppercase tracking-wider text-muted-foreground/50">{field}</p>
                <pre className="max-h-48 overflow-auto rounded bg-surface-2 p-1.5 font-terminal text-[10px] text-muted-foreground">
                  {JSON.stringify(run[field], null, 2)}
                </pre>
              </div>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}

function QuerySkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-2" aria-label="loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-md border border-border bg-surface-2/60" />
      ))}
    </div>
  );
}

function QueryError({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      <span className="flex items-center gap-1.5">
        <AlertTriangle className="size-3.5" /> {label}
      </span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

export function LoopsClient() {
  const loopsQuery = useLoopsQuery();
  const runsQuery = useLoopRunsQuery();
  const loops = loopsQuery.data ?? [];
  const runs = runsQuery.data ?? [];
  const loopNameById = new Map(loops.map((l) => [l.id, l.name]));
  const now = useNowTick(10_000);
  const channels = useConnectionStore((s) => s.channels);
  const live = liveness(channels);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-terminal text-xs uppercase tracking-widest text-muted-foreground">
            Standing loops ({loops.length})
            <span
              className={cn(
                'flex items-center gap-1 rounded-full border px-1.5 py-px font-terminal text-[9px] normal-case tracking-normal',
                live.tone === 'live' && 'border-neon-green/40 text-neon-green/90',
                live.tone === 'warn' && 'border-border text-muted-foreground',
                live.tone === 'down' && 'border-destructive/40 text-destructive',
              )}
              title="Realtime channel status for loops + runs"
            >
              <span className={cn('size-1.5 rounded-full', live.tone === 'live' ? 'bg-neon-green' : live.tone === 'down' ? 'bg-destructive' : 'animate-pulse bg-muted-foreground')} aria-hidden />
              {live.label}
            </span>
          </h2>
          <CreateLoopForm onCreated={() => void loopsQuery.refetch()} />
        </div>
        {loopsQuery.isLoading && <QuerySkeleton rows={3} />}
        {loopsQuery.isError && <QueryError label="Failed to load loops." onRetry={() => void loopsQuery.refetch()} />}
        {!loopsQuery.isLoading && !loopsQuery.isError && loops.length === 0 && (
          <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
            No loops yet. Create a `monitor` loop first to prove the tick/lock/reschedule cycle before wiring anything
            that touches money.
          </p>
        )}
        <div className="flex flex-col gap-2">
          {loops.map((loop) => (
            <LoopRowItem key={loop.id} loop={loop} now={now} onChanged={() => void loopsQuery.refetch()} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-terminal text-xs uppercase tracking-widest text-muted-foreground">Recent runs</h2>
        {runsQuery.isLoading && <QuerySkeleton rows={4} />}
        {runsQuery.isError && <QueryError label="Failed to load runs." onRetry={() => void runsQuery.refetch()} />}
        {!runsQuery.isLoading && !runsQuery.isError && runs.length === 0 && <p className="text-sm text-muted-foreground">No runs yet.</p>}
        <div className="flex flex-col gap-1.5">
          {runs.map((run) => (
            <RunItem key={run.id} run={run} loopName={loopNameById.get(run.loop_id ?? '') ?? 'unknown loop'} now={now} />
          ))}
        </div>
      </section>
    </div>
  );
}

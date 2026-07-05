'use client';

import { useState } from 'react';
import { Play, Pause, Square, Trash2, Plus, Repeat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useLoopsQuery } from '@/hooks/use-loops-query';
import { useLoopRunsQuery } from '@/hooks/use-loop-runs-query';
import type { LoopKind, LoopRow, LoopStatus } from '@/lib/types/database.types';

const KIND_OPTIONS: LoopKind[] = ['monitor', 'research', 'build', 'trade', 'personal'];
const BRAIN_OPTIONS = ['claude', 'codex', 'hermes'] as const;

const STATUS_BADGE: Record<LoopStatus, 'success' | 'muted' | 'error'> = {
  armed: 'success',
  paused: 'muted',
  stopped: 'error',
};

async function patchLoop(id: string, body: Record<string, unknown>) {
  await fetch(`/api/loops/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function CreateLoopForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<LoopKind>('monitor');
  const [objective, setObjective] = useState('');
  const [cadence, setCadence] = useState(30);
  const [brain, setBrain] = useState<(typeof BRAIN_OPTIONS)[number]>('claude');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function submit() {
    if (!name.trim() || !objective.trim()) return;
    setBusy(true);
    try {
      await fetch('/api/loops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, kind, objective, cadence_seconds: cadence, brain }),
      });
      setName('');
      setObjective('');
      setOpen(false);
      onCreated();
    } finally {
      setBusy(false);
    }
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
            Create (paused)
          </Button>
        </div>
      </div>
    </div>
  );
}

function LoopRow_({ loop }: { loop: LoopRow }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border p-3">
      <Repeat className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{loop.name}</span>
          <Badge variant="outline">{loop.kind}</Badge>
          <Badge variant={STATUS_BADGE[loop.status]}>{loop.status}</Badge>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{loop.objective}</p>
        <p className="mt-0.5 font-terminal text-[10px] text-muted-foreground/60">
          cadence {loop.cadence_seconds ? `${loop.cadence_seconds}s` : 'event-only'} · last tick {relativeTime(loop.last_tick_at)} · brain {loop.brain}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button variant="ghost" size="icon-sm" title="Arm" disabled={loop.status === 'armed'} onClick={() => patchLoop(loop.id, { status: 'armed' })}>
          <Play className="text-neon-green" />
        </Button>
        <Button variant="ghost" size="icon-sm" title="Pause" disabled={loop.status === 'paused'} onClick={() => patchLoop(loop.id, { status: 'paused' })}>
          <Pause />
        </Button>
        <Button variant="ghost" size="icon-sm" title="Stop" disabled={loop.status === 'stopped'} onClick={() => patchLoop(loop.id, { status: 'stopped' })}>
          <Square className="text-destructive" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Delete"
          onClick={() => {
            if (confirm(`Delete loop "${loop.name}"? This removes its run history too.`)) {
              void fetch(`/api/loops/${loop.id}`, { method: 'DELETE' });
            }
          }}
        >
          <Trash2 className="text-destructive/70" />
        </Button>
      </div>
    </div>
  );
}

export function LoopsClient() {
  const { data: loops = [], refetch } = useLoopsQuery();
  const { data: runs = [] } = useLoopRunsQuery();
  const loopNameById = new Map(loops.map((l) => [l.id, l.name]));

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="font-terminal text-xs uppercase tracking-widest text-muted-foreground">
            Standing loops ({loops.length})
          </h2>
          <CreateLoopForm onCreated={() => void refetch()} />
        </div>
        {loops.length === 0 && (
          <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
            No loops yet. Create a `monitor` loop first to prove the tick/lock/reschedule cycle before wiring anything
            that touches money.
          </p>
        )}
        <div className="flex flex-col gap-2">
          {loops.map((loop) => (
            <LoopRow_ key={loop.id} loop={loop} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-terminal text-xs uppercase tracking-widest text-muted-foreground">Recent runs</h2>
        <div className="flex flex-col gap-1.5">
          {runs.length === 0 && <p className="text-sm text-muted-foreground">No runs yet.</p>}
          {runs.map((run) => (
            <div key={run.id} className="rounded-md border border-border p-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-foreground">{loopNameById.get(run.loop_id ?? '') ?? 'unknown loop'}</span>
                <Badge
                  variant={run.status === 'completed' ? 'success' : run.status === 'failed' ? 'error' : 'muted'}
                  className={cn(run.status === 'running' && 'animate-pulse')}
                >
                  {run.status}
                </Badge>
              </div>
              <p className="mt-1 text-muted-foreground/80">{relativeTime(run.started_at)}</p>
              {run.decision && (
                <p className="mt-1 truncate font-terminal text-[10px] text-muted-foreground">
                  {JSON.stringify(run.decision).slice(0, 140)}
                </p>
              )}
              {run.error && <p className="mt-1 truncate text-[10px] text-destructive">{run.error}</p>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

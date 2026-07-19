'use client';

import { useEffect, useState } from 'react';
import { Hammer } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkSessionRow } from '@/lib/types/database.types';

/** Heartbeats older than this are NEVER shown as active — a crashed agent
 *  must not leave a lying "working" chip on screen (v0 rule: 2-5 min). */
const STALE_MS = 3 * 60_000;
const POLL_MS = 20_000;

function elapsedLabel(startedIso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - new Date(startedIso).getTime()) / 1000));
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export function WorkSessionChip() {
  const [sessions, setSessions] = useState<WorkSessionRow[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch('/api/work-sessions', { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : { sessions: [] }))
        .then((data: { sessions?: WorkSessionRow[] }) => {
          if (alive) setSessions(Array.isArray(data.sessions) ? data.sessions : []);
        })
        .catch(() => undefined); // chip is informational — never breaks the header
    };
    load();
    const poll = setInterval(load, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);

  const current = sessions.find(
    (s) => s.status === 'active' && now - new Date(s.last_heartbeat_at).getTime() < STALE_MS,
  );
  if (!current) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        title="An agent is working — click for details"
        className={cn(
          'flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5',
          'font-terminal text-[10px] text-primary transition-colors hover:bg-primary/20',
        )}
      >
        <Hammer className="size-2.5 animate-pulse" aria-hidden />
        <span className="max-w-[180px] truncate">
          {current.agent_name} · {current.task_summary}
        </span>
        <span className="tabular-nums text-primary/70">{elapsedLabel(current.started_at, now)}</span>
      </button>
      {expanded && (
        <div className="absolute right-0 top-7 z-50 w-72 rounded-md border border-border bg-background/95 p-2.5 text-xs shadow-lg backdrop-blur">
          <p className="font-medium text-foreground">{current.agent_name}</p>
          <p className="mt-0.5 text-muted-foreground">{current.task_summary}</p>
          <p className="mt-1.5 font-terminal text-[10px] text-muted-foreground/70">
            started {new Date(current.started_at).toLocaleTimeString()} · status {current.status} · heartbeat{' '}
            {Math.round((now - new Date(current.last_heartbeat_at).getTime()) / 1000)}s ago
          </p>
          {current.touched_files.length > 0 && (
            <div className="mt-1.5">
              <p className="font-terminal text-[9px] uppercase tracking-wider text-muted-foreground/50">touched files</p>
              <ul className="mt-0.5 max-h-32 overflow-y-auto font-terminal text-[10px] text-muted-foreground">
                {current.touched_files.map((file) => (
                  <li key={file} className="truncate">{file}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

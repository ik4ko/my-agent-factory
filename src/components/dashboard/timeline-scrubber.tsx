'use client';

import { useMemo } from 'react';
import { History, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { LOGS_KEY } from '@/hooks/use-logs-query';
import { useScrubberStore } from '@/lib/scrubber/scrubber-store';
import type { Log } from '@/lib/types/database.types';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

export function TimelineScrubber() {
  const active = useScrubberStore((s) => s.active);
  const snapshotAt = useScrubberStore((s) => s.snapshotAt);
  const setActive = useScrubberStore((s) => s.setActive);
  const setSnapshot = useScrubberStore((s) => s.setSnapshot);
  const qc = useQueryClient();

  // Bounds derive from the loaded log history — decoupled from live streaming.
  const logs = qc.getQueryData<Log[]>(LOGS_KEY) ?? [];
  const { min, max } = useMemo(() => {
    if (logs.length === 0) return { min: 0, max: 0 };
    const times = logs.map((l) => new Date(l.timestamp).getTime());
    return { min: Math.min(...times), max: Math.max(...times) };
  }, [logs]);

  if (!active) {
    return (
      <button
        onClick={() => setActive(true)}
        suppressHydrationWarning={true}
        title="Open the timeline scrubber"
        className="flex items-center gap-1.5 font-terminal text-[10px] text-muted-foreground/40 transition-colors hover:text-muted-foreground/70"
      >
        <History className="size-3" /> SCRUB
      </button>
    );
  }

  const value = snapshotAt ?? max;
  const isLive = snapshotAt === null;

  return (
    <div className="flex items-center gap-3 rounded-md border border-neon-purple/30 bg-neon-purple/[0.06] px-3 py-1.5">
      <div className="flex items-center gap-1.5 text-neon-purple">
        <History className="size-3" />
        <span className="font-terminal text-[10px] uppercase tracking-wider">Timeline</span>
      </div>

      <input
        type="range"
        min={min}
        max={max}
        step={1000}
        value={value}
        disabled={max === min}
        suppressHydrationWarning={true}
        onChange={(e) => {
          const t = Number(e.target.value);
          setSnapshot(t >= max ? null : t);
        }}
        className="h-1 w-48 cursor-pointer accent-neon-purple"
      />

      <span className={cn('font-terminal text-[10px] tabular', isLive ? 'text-neon-green' : 'text-neon-purple')}>
        {max === 0 ? '—' : isLive ? '● LIVE' : format(new Date(value), 'HH:mm:ss')}
      </span>

      <button
        onClick={() => { setSnapshot(null); setActive(false); }}
        suppressHydrationWarning={true}
        className="text-muted-foreground/40 hover:text-muted-foreground"
        title="Exit historical mode"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

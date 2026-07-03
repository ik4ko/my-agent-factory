'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { useLogsQuery } from '@/hooks/use-logs-query';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { Log, LogLevel } from '@/lib/types/database.types';
import { format } from 'date-fns';
import { useSnapshotAt } from '@/lib/scrubber/scrubber-store';

const LEVEL_STYLE: Record<LogLevel, string> = {
  debug:   'text-muted-foreground/40',
  info:    'text-neon-cyan',
  warn:    'text-neon-orange',
  error:   'text-neon-red',
  success: 'text-neon-green',
};
const LEVEL_PREFIX: Record<LogLevel, string> = {
  debug: 'DBG', info: 'INF', warn: 'WRN', error: 'ERR', success: 'OK ',
};
const LEVEL_MSG_STYLE: Record<LogLevel, string> = {
  debug:   'text-foreground/40',
  info:    'text-foreground/75',
  warn:    'text-warning/80',
  error:   'text-neon-red/80',
  success: 'text-neon-green/80',
};

const ALL_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error', 'success'];

// Windowing constants — ROW_H MUST match the rendered row height (h-5 = 20px).
const ROW_H = 20;
const OVERSCAN = 12;

function LevelToggle({
  level,
  active,
  count,
  onClick,
}: {
  level: LogLevel | 'all';
  active: boolean;
  count?: number;
  onClick: () => void;
}) {
  const label = level === 'all' ? 'ALL' : LEVEL_PREFIX[level as LogLevel];
  const color = level === 'all' ? 'text-muted-foreground' : LEVEL_STYLE[level as LogLevel];

  return (
    <button
      onClick={onClick}
      className={cn(
        'font-terminal text-[10px] px-1.5 py-0.5 rounded transition-all duration-100',
        active
          ? cn('bg-surface-2 border border-border', color)
          : 'text-muted-foreground/30 hover:text-muted-foreground/60'
      )}
    >
      {label}
      {count !== undefined && active && count > 0 && (
        <span className="ml-1 opacity-50">({count})</span>
      )}
    </button>
  );
}

// Memoized, fixed-height, single-line row. Logs are immutable by id, so the
// default shallow prop check makes re-renders essentially free while scrolling.
const LogLine = memo(function LogLine({ log }: { log: Log }) {
  return (
    <div
      className="flex h-5 items-center gap-2 rounded-sm px-1 leading-5 hover:bg-surface-2/50"
      title={log.message}
    >
      <span className="shrink-0 text-muted-foreground/25 tabular">
        {format(new Date(log.timestamp), 'HH:mm:ss')}
      </span>
      <span className={cn('w-7 shrink-0 font-bold tabular', LEVEL_STYLE[log.level])}>
        {LEVEL_PREFIX[log.level]}
      </span>
      <span className={cn('truncate', LEVEL_MSG_STYLE[log.level])}>{log.message}</span>
    </div>
  );
});

export function LogTerminal({ initialLogs = [] }: { initialLogs?: Log[] }) {
  const { data: rawLogs = [], isLoading } = useLogsQuery(initialLogs);
  const snapshotAt = useSnapshotAt();
  // Historical snapshot: logs are append-only + timestamped, so reconstruction is exact.
  const allLogs = snapshotAt === null
    ? rawLogs
    : rawLogs.filter((l) => new Date(l.timestamp).getTime() <= snapshotAt);
  const [activeLevel, setActiveLevel] = useState<LogLevel | 'all'>('all');
  const [autoScroll, setAutoScroll] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(0);

  const logs = activeLevel === 'all'
    ? allLogs
    : allLogs.filter((l) => l.level === activeLevel);
  const total = logs.length;

  // Track viewport height for the windowing math.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Pin to newest when the user is at the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (autoScroll && snapshotAt === null && el) el.scrollTop = el.scrollHeight;
  }, [total, autoScroll, snapshotAt]);

  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const endIdx = Math.min(total, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);
  const visible = logs.slice(startIdx, endIdx);

  const levelCounts = ALL_LEVELS.reduce((acc, lvl) => {
    acc[lvl] = allLogs.filter((l) => l.level === lvl).length;
    return acc;
  }, {} as Record<LogLevel, number>);

  return (
    <div className="flex h-full flex-col gap-2">
      {/* Terminal header */}
      <div className="flex items-center gap-3 border-b border-border pb-2 shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="size-2 rounded-full bg-neon-red/60" />
          <div className="size-2 rounded-full bg-neon-orange/60" />
          <div className="size-2 rounded-full bg-neon-green/60" />
        </div>

        <div className="flex items-center gap-1">
          <LevelToggle
            level="all"
            active={activeLevel === 'all'}
            count={allLogs.length}
            onClick={() => setActiveLevel('all')}
          />
          {ALL_LEVELS.map((lvl) => (
            <LevelToggle
              key={lvl}
              level={lvl}
              active={activeLevel === lvl}
              count={levelCounts[lvl]}
              onClick={() => setActiveLevel(activeLevel === lvl ? 'all' : lvl)}
            />
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => {
              const el = scrollRef.current;
              const next = !autoScroll;
              setAutoScroll(next);
              if (next && el) el.scrollTop = el.scrollHeight;
            }}
            className={cn(
              'font-terminal text-[10px] transition-colors duration-100',
              autoScroll ? 'text-neon-green animate-glow-pulse' : 'text-muted-foreground/30'
            )}
          >
            {autoScroll ? '● LIVE' : '○ PAUSED'}
          </button>
        </div>
      </div>

      {/* Windowed log output */}
      <div
        ref={scrollRef}
        className="font-terminal relative flex-1 overflow-y-auto pr-1"
        onScroll={(e) => {
          const el = e.currentTarget;
          setScrollTop(el.scrollTop);
          setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
        }}
      >
        {isLoading ? (
          <div className="space-y-1.5 p-1">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-3" style={{ width: `${60 + (i * 13) % 35}%` }} />
            ))}
          </div>
        ) : total === 0 ? (
          <div className="flex h-full items-center justify-center">
            <span className="font-terminal text-xs text-muted-foreground/30">
              No {activeLevel !== 'all' ? activeLevel : ''} logs yet
            </span>
          </div>
        ) : (
          <div style={{ height: total * ROW_H }} className="relative">
            <div style={{ transform: `translateY(${startIdx * ROW_H}px)` }}>
              {visible.map((log) => (
                <LogLine key={log.id} log={log} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

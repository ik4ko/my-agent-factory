'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLogsQuery } from '@/hooks/use-logs-query';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { Log, LogLevel } from '@/lib/types/database.types';
import { format } from 'date-fns';

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

function LogLine({ log }: { log: Log }) {
  const ts = format(new Date(log.timestamp), 'HH:mm:ss');
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.12 }}
      className="flex items-start gap-2 hover:bg-surface-2/50 px-1 rounded-sm py-px"
    >
      <span className="shrink-0 text-muted-foreground/25 tabular">{ts}</span>
      <span className={cn('shrink-0 font-bold tabular w-7', LEVEL_STYLE[log.level])}>
        {LEVEL_PREFIX[log.level]}
      </span>
      <span className={cn('break-words leading-relaxed', LEVEL_MSG_STYLE[log.level])}>
        {log.message}
      </span>
    </motion.div>
  );
}

export function LogTerminal({ initialLogs = [] }: { initialLogs?: Log[] }) {
  const { data: allLogs = [], isLoading } = useLogsQuery(initialLogs);
  const [activeLevel, setActiveLevel] = useState<LogLevel | 'all'>('all');
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const logs = activeLevel === 'all'
    ? allLogs
    : allLogs.filter((l) => l.level === activeLevel);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs.length, autoScroll]);

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
            onClick={() => setAutoScroll((v) => !v)}
            className={cn(
              'font-terminal text-[10px] transition-colors duration-100',
              autoScroll ? 'text-neon-green animate-glow-pulse' : 'text-muted-foreground/30'
            )}
          >
            {autoScroll ? '● LIVE' : '○ PAUSED'}
          </button>
        </div>
      </div>

      {/* Log output */}
      <div
        className="font-terminal flex-1 overflow-y-auto pr-1 relative"
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          setAutoScroll(atBottom);
        }}
      >
        {isLoading ? (
          <div className="space-y-1.5 p-1">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-3" style={{ width: `${60 + (i * 13) % 35}%` }} />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <span className="font-terminal text-xs text-muted-foreground/30">
              No {activeLevel !== 'all' ? activeLevel : ''} logs yet
            </span>
          </div>
        ) : (
          <AnimatePresence initial={false} mode="popLayout">
            {logs.map((log) => (
              <LogLine key={log.id} log={log} />
            ))}
          </AnimatePresence>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

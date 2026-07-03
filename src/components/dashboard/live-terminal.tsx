'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Terminal, ChevronsDown } from 'lucide-react';
import { useLogsQuery } from '@/hooks/use-logs-query';
import { TASKS_KEY } from '@/hooks/use-tasks-query';
import { createClient } from '@/lib/supabase/client';
import { shortModel } from '@/lib/telemetry/pricing';
import { cn } from '@/lib/utils';
import type { Log, LogLevel, Task } from '@/lib/types/database.types';

const LEVEL_CLS: Record<LogLevel, string> = {
  debug: 'text-muted-foreground/50',
  info: 'text-foreground/80',
  warn: 'text-neon-orange',
  error: 'text-neon-red',
  success: 'text-neon-green',
};
const LEVEL_TAG: Record<LogLevel, string> = {
  debug: 'DBG',
  info: 'INF',
  warn: 'WRN',
  error: 'ERR',
  success: ' OK',
};

interface StreamPreview {
  streaming?: boolean;
  chars?: number;
  preview?: string;
  model?: string;
}

const LogLine = memo(function LogLine({ log }: { log: Log }) {
  const t = new Date(log.timestamp);
  const hh = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
  return (
    <div className="flex gap-2 whitespace-pre-wrap break-words leading-relaxed animate-fade-in-up">
      <span className="shrink-0 text-muted-foreground/30 tabular">{hh}</span>
      <span className={cn('shrink-0 font-semibold', LEVEL_CLS[log.level])}>{LEVEL_TAG[log.level]}</span>
      <span className={cn('min-w-0', LEVEL_CLS[log.level])}>{log.message}</span>
    </div>
  );
});

/** Live character stream for one running task (tasks.result flushes ~1.5s). */
const StreamBlock = memo(function StreamBlock({ task }: { task: Task }) {
  const r = (task.result ?? {}) as StreamPreview;
  return (
    <div className="mt-1 rounded border border-primary/20 bg-primary/[0.04] px-2 py-1.5 animate-fade-in-up">
      <div className="flex items-center gap-2 text-[10px] text-primary/80">
        <span className="size-1.5 rounded-full bg-primary animate-glow-pulse" />
        <span className="font-semibold">▶ {task.id.slice(0, 8)}</span>
        <span className="text-muted-foreground/50">{shortModel(r.model ?? task.model)}</span>
        <span className="ml-auto tabular text-muted-foreground/40">{r.chars ?? 0} chars</span>
      </div>
      {r.preview && (
        <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-foreground/70">
          {r.preview}
          <span className="ml-0.5 inline-block h-3 w-1.5 translate-y-0.5 bg-primary animate-glow-pulse" />
        </p>
      )}
    </div>
  );
});

interface LiveTerminalProps {
  initialLogs?: Log[];
}

/**
 * Obsidian/emerald terminal fusing the system log stream with live per-task
 * character output. Owns the logs realtime subscription (via useLogsQuery);
 * reads the tasks stream passively from the shared TanStack cache (the
 * TaskFeed's subscription keeps it hot). Auto-scrolls unless the operator
 * scrolls up; a jump chip restores tailing.
 */
export function LiveTerminal({ initialLogs = [] }: LiveTerminalProps) {
  const { data: logs = [] } = useLogsQuery(initialLogs);

  // Passive cache read — no second realtime channel for tasks.
  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: TASKS_KEY,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from('tasks')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });

  const streaming = useMemo(
    () =>
      tasks.filter(
        (t) => t.status === 'running' && Boolean((t.result as StreamPreview | null)?.streaming)
      ),
    [tasks]
  );

  // Oldest-first for terminal reading order (hook returns newest-first).
  const lines = useMemo(() => [...logs].reverse(), [logs]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    if (pinned && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, streaming, pinned]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  };

  return (
    <div className="relative flex h-full flex-col gap-2">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5">
          <Terminal className="size-3 text-primary" />
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Live Terminal</span>
        </div>
        <div className="flex items-center gap-2 font-terminal text-[10px]">
          {streaming.length > 0 && (
            <span className="text-primary animate-glow-pulse">{streaming.length} streaming</span>
          )}
          <span className="text-muted-foreground/40">{logs.length} lines</span>
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto rounded-lg border border-border bg-background/80 p-2.5 font-terminal text-[11px]"
      >
        {lines.length === 0 && streaming.length === 0 ? (
          <p className="text-muted-foreground/40">— no activity yet —</p>
        ) : (
          <>
            {lines.map((log) => (
              <LogLine key={log.id} log={log} />
            ))}
            {streaming.map((task) => (
              <StreamBlock key={task.id} task={task} />
            ))}
          </>
        )}
      </div>

      {!pinned && (
        <button
          onClick={() => {
            setPinned(true);
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
          }}
          className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full border border-primary/30 bg-surface-2 px-2 py-1 font-terminal text-[10px] text-primary shadow-card-lift hover:bg-surface-3"
        >
          <ChevronsDown className="size-3" /> tail
        </button>
      )}
    </div>
  );
}

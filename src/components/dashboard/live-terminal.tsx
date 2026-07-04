'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Terminal, ChevronsDown } from 'lucide-react';
import { useLogsQuery } from '@/hooks/use-logs-query';
import { TASKS_KEY } from '@/hooks/use-tasks-query';
import { AGENTS_KEY } from '@/hooks/use-agents-query';
import { createClient } from '@/lib/supabase/client';
import { subscribeWithReconnect } from '@/lib/supabase/realtime';
import { useConnectionStore } from '@/lib/realtime/connection-store';
import { shortModel } from '@/lib/telemetry/pricing';
import type { RobinhoodStagedOrder } from '@/lib/types/trading.types';
import { cn } from '@/lib/utils';
import { useSystemFeed, type FeedChannel, type SystemFeedEntry } from '@/lib/fx/system-feed';
import type { Agent, Log, LogLevel, Task } from '@/lib/types/database.types';

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

const CHANNEL_CLS: Record<FeedChannel, string> = {
  SYSTEM: 'text-neon-cyan',
  NETWORK: 'text-neon-purple',
  DISPATCH: 'text-primary',
  VOICE: 'text-neon-orange',
  COGNITION: 'text-foreground/50 italic',
  STRATEGY: 'text-neon-green',
  CRITICAL: 'text-neon-red font-semibold',
};

const STAGED_ORDERS_CHANNEL = 'staged-orders-stream';

function hhmmss(iso: string): string {
  const t = new Date(iso);
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
}

/** Client-side diagnostics line: "[09:35:02] SYSTEM: Synchronizing…" */
const SysLine = memo(function SysLine({ entry }: { entry: SystemFeedEntry }) {
  return (
    <div className="flex gap-2 whitespace-pre-wrap break-words leading-relaxed animate-fade-in-up">
      <span className="shrink-0 text-muted-foreground/30 tabular">[{hhmmss(entry.timestamp)}]</span>
      <span className={cn('shrink-0 font-semibold', CHANNEL_CLS[entry.channel])}>{entry.channel}:</span>
      <span className="min-w-0 text-foreground/70">{entry.message}</span>
    </div>
  );
});

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

  // Passive cache read — AgentFleet's subscription keeps this hot too.
  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: AGENTS_KEY,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from('agents')
        .select('*')
        .order('created_at', { ascending: true });
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

  // Diagnostics producer: diff agent statuses as realtime pushes them into
  // the shared cache and emit a transition line. First pass only seeds the
  // baseline — no spam on initial load.
  const pushFeed = useSystemFeed((s) => s.push);
  const prevStatusRef = useRef<Map<string, string> | null>(null);
  const prevHaltRef = useRef<Map<string, boolean>>(new Map());
  useEffect(() => {
    if (agents.length === 0) return;
    const prev = prevStatusRef.current;
    if (prev) {
      for (const a of agents) {
        const was = prev.get(a.id);
        if (was && was !== a.status) {
          pushFeed(
            'SYSTEM',
            `${a.name} core state transition ${was.toUpperCase()} → ${a.status.toUpperCase()}`,
          );
        }
        // Autonomous kill-switch halt: surfaces the CRITICAL ring-buffer line
        // when the runner flips halted_at with the critical_halt marker.
        const haltedNow = Boolean(a.halted_at);
        const haltedBefore = prevHaltRef.current.get(a.id) ?? false;
        if (haltedNow && !haltedBefore && a.metadata?.critical_halt) {
          pushFeed(
            'CRITICAL',
            'Autonomous trade velocity ceiling reached. Activation paused for risk mitigation.',
          );
        }
      }
    }
    prevStatusRef.current = new Map(agents.map((a) => [a.id, a.status]));
    prevHaltRef.current = new Map(agents.map((a) => [a.id, Boolean(a.halted_at)]));
  }, [agents, pushFeed]);

  // NETWORK telemetry producer: the market fetcher logs its pull server-side;
  // mirror newly arrived pull lines into the ring buffer as NETWORK entries.
  // Cursor starts at the newest historical log so page load never replays.
  const telemetryCursorRef = useRef<number>(0);
  useEffect(() => {
    if (logs.length === 0) return;
    const newestTs = logs.reduce((max, l) => Math.max(max, Date.parse(l.timestamp)), 0);
    if (telemetryCursorRef.current === 0) {
      telemetryCursorRef.current = newestTs;
      return;
    }
    for (const log of logs) {
      const ts = Date.parse(log.timestamp);
      if (ts > telemetryCursorRef.current && log.message.startsWith('Pulled live telemetry')) {
        pushFeed('NETWORK', log.message);
      }
    }
    telemetryCursorRef.current = Math.max(telemetryCursorRef.current, newestTs);
  }, [logs, pushFeed]);

  // Cognition producer: forward newly generated characters from live model
  // streams (workers flush rolling previews to tasks.result every ~1.5s and
  // realtime pushes them here) into the diagnostics feed, so the terminal
  // shows the agents "thinking" line by line. Delta extraction is
  // approximate (previews are rolling 400-char windows) and throttled to
  // ≥48 new chars per line to avoid ring-buffer churn.
  const streamProgressRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const seen = streamProgressRef.current;
    for (const task of streaming) {
      const r = (task.result ?? {}) as StreamPreview;
      const chars = r.chars ?? 0;
      if (!seen.has(task.id)) {
        seen.set(task.id, 0);
        pushFeed(
          'COGNITION',
          `${task.id.slice(0, 8)} cognition stream opened${r.model ? ` · ${shortModel(r.model)}` : ''}`,
        );
      }
      const prev = seen.get(task.id) ?? 0;
      if (chars - prev >= 48 && r.preview) {
        const delta = r.preview
          .slice(-Math.min(chars - prev, 240))
          .replace(/\s+/g, ' ')
          .trim();
        if (delta) pushFeed('COGNITION', `${task.id.slice(0, 8)} ▸ ${delta}`);
        seen.set(task.id, chars);
      }
    }
    // Prune finished streams so the map never grows unbounded.
    const active = new Set(streaming.map((t) => t.id));
    for (const id of seen.keys()) if (!active.has(id)) seen.delete(id);
  }, [streaming, pushFeed]);

  // STRATEGY producer: staged_orders INSERTs (order proposals awaiting human
  // approval) stream in over realtime and land as STRATEGY feed lines.
  useEffect(() => {
    const supabase = createClient();
    const { setChannelStatus, clearChannel } = useConnectionStore.getState();
    const dispose = subscribeWithReconnect({
      client: supabase,
      name: STAGED_ORDERS_CHANNEL,
      onStatusChange: (s) => setChannelStatus(STAGED_ORDERS_CHANNEL, s),
      build: (channel) =>
        channel.on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'staged_orders' },
          (payload) => {
            const order = payload.new as RobinhoodStagedOrder;
            useSystemFeed
              .getState()
              .push(
                'STRATEGY',
                `Order staged for underlying ${order.underlying}. Kelly allocation: ${(order.kelly_fraction * 100).toFixed(2)}%. Awaiting manual verification.`,
              );
          },
        ),
    });
    return () => {
      dispose();
      clearChannel(STAGED_ORDERS_CHANNEL);
    };
  }, []);

  // Merge persisted DB logs with client diagnostics, oldest-first by
  // timestamp for terminal reading order (logs hook returns newest-first).
  const feed = useSystemFeed((s) => s.entries);
  const lines = useMemo(() => {
    const merged: Array<
      | { kind: 'db'; key: string; ts: number; log: Log }
      | { kind: 'sys'; key: string; ts: number; entry: SystemFeedEntry }
    > = [
      ...logs.map((log) => ({ kind: 'db' as const, key: log.id, ts: Date.parse(log.timestamp), log })),
      ...feed.map((entry) => ({ kind: 'sys' as const, key: entry.id, ts: Date.parse(entry.timestamp), entry })),
    ];
    merged.sort((a, b) => a.ts - b.ts);
    return merged;
  }, [logs, feed]);

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
          <span className="text-muted-foreground/40">{lines.length} lines</span>
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
            {lines.map((row) =>
              row.kind === 'db' ? (
                <LogLine key={row.key} log={row.log} />
              ) : (
                <SysLine key={row.key} entry={row.entry} />
              ),
            )}
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

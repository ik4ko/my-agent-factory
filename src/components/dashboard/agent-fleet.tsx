'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Code2, Search, Globe, Layers, ChevronDown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAgentsQuery } from '@/hooks/use-agents-query';
import { TASKS_KEY } from '@/hooks/use-tasks-query';
import { METRICS_KEY, fetchMetrics24h } from '@/hooks/use-metrics-query';
import { createClient } from '@/lib/supabase/client';
import { shortModel } from '@/lib/telemetry/pricing';
import { StatusDot } from './status-dot';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { Agent, AgentType, Metric, Task } from '@/lib/types/database.types';
import { formatDistanceToNow } from 'date-fns';
import { useSnapshotAt } from '@/lib/scrubber/scrubber-store';
import { useCoreFxStore } from '@/lib/fx/core-store';
import { useAgentTelemetryStore, EMPTY_TELEMETRY } from '@/lib/fx/agent-telemetry';

function formatLatency(ms: number | null): string {
  if (ms == null) return '—';
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Hover producer for the CinematicCore beam. rAF-debounced: rapid
 * enter/leave sweeps across the fleet coalesce into at most one
 * getBoundingClientRect + store write per frame (no layout thrashing,
 * no hover-flicker).
 */
function useHoverFocus(agentId: string) {
  const cardRef = useRef<HTMLDivElement>(null);
  const setFocusTarget = useCoreFxStore((s) => s.setFocusTarget);
  const rafRef = useRef(0);

  const onMouseEnter = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const el = cardRef.current;
      if (el) setFocusTarget(agentId, el.getBoundingClientRect());
    });
  }, [agentId, setFocusTarget]);

  const onMouseLeave = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    setFocusTarget(null, null);
  }, [setFocusTarget]);

  // If a focused card unmounts (agent removed while hovered), release the
  // beam — but never clobber focus that already moved to another card.
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      const store = useCoreFxStore.getState();
      if (store.focusedAgentId === agentId) store.setFocusTarget(null, null);
    };
  }, [agentId]);

  return { cardRef, onMouseEnter, onMouseLeave };
}

// Infer visual type from agent name (no type column in schema)
function inferAgentType(name: string): AgentType {
  const n = name.toLowerCase();
  if (n.includes('codex'))    return 'coder';
  if (n.includes('scout'))    return 'researcher';
  if (n.includes('phantom'))  return 'browser';
  if (n.includes('architect')) return 'planner';
  return 'generic';
}

const TYPE_ICON: Record<AgentType, React.ElementType> = {
  generic: Activity, coder: Code2, researcher: Search,
  browser: Globe, planner: Layers,
};
const TYPE_COLOR: Record<AgentType, string> = {
  generic: 'text-neon-green', coder: 'text-neon-cyan',
  researcher: 'text-neon-purple', browser: 'text-neon-orange', planner: 'text-primary',
};
const TYPE_BG: Record<AgentType, string> = {
  generic: 'bg-neon-green/10', coder: 'bg-neon-cyan/10',
  researcher: 'bg-neon-purple/10', browser: 'bg-neon-orange/10', planner: 'bg-primary/10',
};

const STATUS_BADGE = {
  idle:    'success' as const,
  busy:    'cyan'    as const,
  error:   'error'   as const,
  offline: 'muted'   as const,
};

// Memoized: a status change on one agent must not re-render the whole fleet.
export interface ModelLane {
  transition: 'SEAT' | 'UP' | 'DOWN';
  model: string;
}

const LANE_CLS: Record<ModelLane['transition'], string> = {
  UP:   'border-neon-purple/40 bg-neon-purple/10 text-neon-purple',
  DOWN: 'border-neon-orange/40 bg-neon-orange/10 text-neon-orange',
  SEAT: 'border-neon-cyan/30 bg-neon-cyan/10 text-neon-cyan',
};

const AgentCard = memo(function AgentCard({ agent, lane }: { agent: Agent; lane: ModelLane | null }) {
  const [expanded, setExpanded] = useState(false);
  const { cardRef, onMouseEnter, onMouseLeave } = useHoverFocus(agent.id);
  // Atomic slice subscription: this card re-renders only when ITS telemetry
  // object is replaced (the store patches per-agent, preserving other refs).
  const telemetry = useAgentTelemetryStore((s) => s.byAgent[agent.id]) ?? EMPTY_TELEMETRY;
  const agentType = agent.type ?? inferAgentType(agent.name);
  const Icon = TYPE_ICON[agentType];
  const iconColor = TYPE_COLOR[agentType];
  const iconBg = TYPE_BG[agentType];

  const since = agent.created_at
    ? formatDistanceToNow(new Date(agent.created_at), { addSuffix: true, includeSeconds: true })
    : '—';
  const halted = Boolean(agent.halted_at);
  const paused = Boolean(agent.paused) && !halted;

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.18 }}
    >
      <div
        ref={cardRef}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className={cn(
          'group relative rounded-lg border border-border bg-surface-1',
          'cursor-pointer transition-colors duration-150',
          'hover:border-border/80 hover:bg-surface-2',
          agent.status === 'idle' && !paused && !halted &&
            'border-neon-green/25 [box-shadow:0_0_10px_hsl(var(--neon-green)/0.12)]',
          agent.status === 'busy' &&
            'border-neon-orange/30 bg-gradient-to-r from-neon-orange/[0.02] via-neon-orange/[0.09] to-neon-orange/[0.02] bg-[length:200%_100%] animate-shimmer',
          agent.status === 'error' && 'border-neon-red/20',
          paused && 'border-border bg-surface-3/70 opacity-60 saturate-50',
          halted && 'border-neon-red/40 bg-neon-red/[0.05]',
          expanded && 'border-primary/25 bg-surface-2'
        )}
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setExpanded((v) => !v)}
      >
        <div className="flex items-start justify-between gap-2 p-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg border border-border', iconBg, iconColor)}>
              <Icon className="size-3.5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-foreground">{agent.name}</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{agentType}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <StatusDot status={agent.status} size="md" />
            <ChevronDown
              className={cn(
                'size-3 text-muted-foreground/40 transition-transform duration-200',
                expanded && 'rotate-180'
              )}
            />
          </div>
        </div>

        {/* Collapsed summary row */}
        <div className="flex items-center justify-between px-2.5 pb-2">
          {halted ? (
            <Badge variant="error">halted</Badge>
          ) : paused ? (
            <Badge variant="warning">paused</Badge>
          ) : (
            <Badge variant={STATUS_BADGE[agent.status]}>{agent.status}</Badge>
          )}
          <div className="flex items-center gap-1.5">
            {lane && (
              <span
                className={cn(
                  'rounded border px-1.5 py-0.5 font-terminal text-[10px] font-semibold tracking-wide',
                  LANE_CLS[lane.transition]
                )}
              >
                {lane.transition}: {shortModel(lane.model)}
              </span>
            )}
            <span className="font-terminal text-[10px] text-muted-foreground/40 tabular">{since}</span>
          </div>
        </div>

        {/* Telemetry strip — session compute diagnostics (BRAIN / LAT / OPS) */}
        <div className="flex items-center justify-between border-t border-border/40 px-2.5 py-1 font-terminal text-[9px] leading-none">
          <span className="flex items-center gap-1">
            <span className="uppercase tracking-wider text-muted-foreground/30">Brain</span>
            <span className={telemetry.model ? 'text-neon-cyan/80' : 'text-muted-foreground/40'}>
              {telemetry.model ? shortModel(telemetry.model) : '—'}
            </span>
          </span>
          <span className="flex items-center gap-1">
            <span className="uppercase tracking-wider text-muted-foreground/30">Lat</span>
            <span className={cn('tabular', telemetry.lastLatencyMs != null ? 'text-neon-green/80' : 'text-muted-foreground/40')}>
              {formatLatency(telemetry.lastLatencyMs)}
            </span>
          </span>
          <span className="flex items-center gap-1">
            <span className="uppercase tracking-wider text-muted-foreground/30">Ops</span>
            <span className="tabular text-neon-purple/80">{telemetry.opsCompleted}</span>
          </span>
        </div>

        {/* Expanded details */}
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div className="border-t border-border/60 px-2.5 py-2 space-y-1.5">
                <div className="flex justify-between font-terminal text-[10px]">
                  <span className="text-muted-foreground/50">ID</span>
                  <span className="text-muted-foreground/70 truncate max-w-[140px]">{agent.id.slice(0, 8)}…</span>
                </div>
                {agent.current_task_id && (
                  <div className="flex justify-between font-terminal text-[10px]">
                    <span className="text-muted-foreground/50">Task</span>
                    <span className="text-neon-cyan truncate max-w-[140px]">
                      {agent.current_task_id.slice(0, 8)}…
                    </span>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
});

function AgentSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-surface-1 p-2.5 space-y-2.5">
      <div className="flex items-center gap-2.5">
        <Skeleton className="size-8 rounded-lg shrink-0" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-2 w-12" />
        </div>
        <Skeleton className="size-2 rounded-full" />
      </div>
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-14 rounded" />
        <Skeleton className="h-2 w-16" />
      </div>
    </div>
  );
}

interface AgentFleetProps {
  initialAgents?: Agent[];
}

/** Passive cache reads — TaskFeed / MetricsBar own the realtime channels. */
function useModelLanes(): { lanes: Map<string, ModelLane>; tasks: Task[] } {
  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: TASKS_KEY,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from('tasks').select('*').order('created_at', { ascending: false }).limit(20);
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });
  const { data: metrics = [] } = useQuery<Metric[]>({
    queryKey: METRICS_KEY,
    queryFn: fetchMetrics24h,
    staleTime: 60_000,
  });

  // newest-first: first SEAT/UP/DOWN per task wins
  const transitionByTask = new Map<string, ModelLane['transition']>();
  for (const m of metrics) {
    if ((m.event === 'SEAT' || m.event === 'UP' || m.event === 'DOWN') && m.task_id && !transitionByTask.has(m.task_id)) {
      transitionByTask.set(m.task_id, m.event);
    }
  }

  const lanes = new Map<string, ModelLane>();
  for (const t of tasks) {
    if (t.status !== 'running' || !t.agent_id || !t.model) continue;
    lanes.set(t.agent_id, { model: t.model, transition: transitionByTask.get(t.id) ?? 'SEAT' });
  }
  return { lanes, tasks };
}

export function AgentFleet({ initialAgents = [] }: AgentFleetProps) {
  const { data: rawAgents = [], isLoading } = useAgentsQuery(initialAgents);
  const { lanes, tasks } = useModelLanes();
  const snapshotAt = useSnapshotAt();

  // ---- Telemetry producers -------------------------------------------------
  // AgentFleet already re-renders on agents/tasks cache updates; these diffs
  // funnel only MEANINGFUL transitions into the telemetry store, where each
  // memoized card subscribes to its own slice (no fleet-wide re-renders).

  // Busy→idle latency measurement from live status transitions.
  const prevAgentStatusRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const now = Date.now();
    const store = useAgentTelemetryStore.getState();
    const prev = prevAgentStatusRef.current;
    for (const a of rawAgents) {
      const was = prev.get(a.id);
      if (was === a.status) continue;
      if (a.status === 'busy') store.markBusy(a.id, now);
      else if (was === 'busy') store.markIdle(a.id, now);
    }
    prevAgentStatusRef.current = new Map(rawAgents.map((a) => [a.id, a.status]));
  }, [rawAgents]);

  // Op counter + model badge from task completions; first pass seeds a
  // historical baseline (model + updated_at−created_at fallback latency)
  // without inflating the session counter.
  const prevTaskStatusRef = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (tasks.length === 0) return;
    const store = useAgentTelemetryStore.getState();
    const prev = prevTaskStatusRef.current;
    if (prev === null) {
      const seeded = new Set<string>();
      for (const t of tasks) {
        // hook returns newest-first: first completed task per agent wins
        if (t.status !== 'completed' || !t.agent_id || seeded.has(t.agent_id)) continue;
        seeded.add(t.agent_id);
        const span = t.updated_at ? Date.parse(t.updated_at) - Date.parse(t.created_at) : NaN;
        store.seed(t.agent_id, t.model ?? null, Number.isFinite(span) && span > 0 ? span : null);
      }
    } else {
      for (const t of tasks) {
        const was = prev.get(t.id);
        if (was && was !== 'completed' && t.status === 'completed' && t.agent_id) {
          store.recordCompletion(t.agent_id, t.model ?? null);
        }
      }
    }
    prevTaskStatusRef.current = new Map(tasks.map((t) => [t.id, t.status]));
  }, [tasks]);

  const historical = snapshotAt !== null;
  const agents = historical
    ? rawAgents.filter((a) => new Date(a.created_at).getTime() <= snapshotAt)
    : rawAgents;

  const counts = agents.reduce((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className={cn('flex h-full flex-col gap-2.5', historical && 'opacity-90 saturate-[0.6]')}>
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Fleet</span>
          {!isLoading && (
            <span className="font-terminal text-[10px] text-muted-foreground/40">({agents.length})</span>
          )}
        </div>
        {!isLoading && (
          <div className="flex items-center gap-2 font-terminal text-[10px]">
            {(counts.busy    ?? 0) > 0 && <span className="text-neon-cyan">{counts.busy} busy</span>}
            {(counts.idle    ?? 0) > 0 && <span className="text-neon-green">{counts.idle} idle</span>}
            {(counts.offline ?? 0) > 0 && <span className="text-muted-foreground/40">{counts.offline} offline</span>}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-1.5 pr-0.5">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <AgentSkeleton key={i} />)
          ) : (
            <AnimatePresence mode="popLayout" initial={false}>
              {agents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} lane={lanes.get(agent.id) ?? null} />
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>
    </div>
  );
}

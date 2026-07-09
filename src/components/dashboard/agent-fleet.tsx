'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Archive, Code2, Search, Globe, Layers, ChevronDown, EyeOff, X, type LucideIcon } from 'lucide-react';
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
import { partitionFleet, type FieldState } from '@/lib/types/control-room.types';
import { agentInScope, tradingAgentIdsFromTasks, type RoomScope } from '@/lib/rooms/scope';
import { formatDistanceToNow } from 'date-fns';
import { useSnapshotAt } from '@/lib/scrubber/scrubber-store';
import { useCoreFxStore } from '@/lib/fx/core-store';
import { useAgentTelemetryStore, EMPTY_TELEMETRY } from '@/lib/fx/agent-telemetry';

function formatLatency(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Hover producer for the Brain Hub highlight — hovering a fleet card lights
 * up the brain node its agent maps to. rAF-debounced: rapid enter/leave
 * sweeps across the fleet coalesce into at most one getBoundingClientRect +
 * store write per frame (no layout thrashing, no hover-flicker).
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

const TYPE_ICON: Record<AgentType, LucideIcon> = {
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

/** Historical per-agent compute facts derived from the task/metric tables —
 *  the fallback when the live session telemetry store has nothing yet. */
interface DerivedTelemetry {
  model: string | null;
  spanMs: number | null;
  completed: number;
}
const EMPTY_DERIVED: DerivedTelemetry = { model: null, spanMs: null, completed: 0 };

/** DB timestamps here mix `timestamptz` and naive-UTC `timestamp` columns;
 *  parsing a naive value as local time skews spans by the UTC offset. Treat
 *  suffix-less timestamps as UTC. */
function parseUtcMs(iso: string): number {
  return Date.parse(/Z$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
}

/** One BRAIN/LAT/OPS cell. Never a bare dash: empty and error states render a
 *  short word with the full reason as tooltip + aria-label. */
const TelemetryValue = memo(function TelemetryValue({
  field,
  readyCls,
  emptyLabel,
}: {
  field: FieldState<string>;
  readyCls: string;
  /** short word for the empty state ('no ops' when the agent never ran;
   *  'n/a' when it ran but the datum was not recorded) */
  emptyLabel: string;
}) {
  if (field.status === 'ready') return <span className={readyCls}>{field.value}</span>;
  if (field.status === 'loading')
    return (
      <span className="text-muted-foreground/40" aria-busy="true" title="Loading telemetry…">
        …
      </span>
    );
  return (
    <span
      className={cn('lowercase', field.status === 'error' ? 'text-neon-red/70' : 'text-muted-foreground/40')}
      title={field.reason}
      aria-label={field.reason}
    >
      {field.status === 'error' ? 'error' : emptyLabel}
    </span>
  );
});

const AgentCard = memo(function AgentCard({
  agent,
  lane,
  derived,
  telemetryLoading,
  telemetryError,
}: {
  agent: Agent;
  lane: ModelLane | null;
  derived: DerivedTelemetry;
  telemetryLoading: boolean;
  telemetryError: boolean;
}) {
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

  // Live session telemetry wins; historical task-derived facts back-fill;
  // anything else is an explicit, explained empty/loading/error state.
  const brainField: FieldState<string> = telemetry.model
    ? { status: 'ready', value: shortModel(telemetry.model) }
    : derived.model
      ? { status: 'ready', value: shortModel(derived.model) }
      : telemetryError
        ? { status: 'error', reason: 'Task history failed to load — brain unknown' }
        : telemetryLoading
          ? { status: 'loading' }
          : derived.completed === 0
            ? { status: 'empty', reason: 'No completed tasks yet — brain appears after this agent’s first run' }
            : { status: 'empty', reason: 'Completed tasks did not record a model name' };

  const latMs = telemetry.lastLatencyMs ?? derived.spanMs;
  const latField: FieldState<string> = latMs != null
    ? { status: 'ready', value: formatLatency(latMs) }
    : telemetryError
      ? { status: 'error', reason: 'Task history failed to load — latency unknown' }
      : telemetryLoading
        ? { status: 'loading' }
        : derived.completed === 0
          ? { status: 'empty', reason: 'No completed tasks yet — latency appears after this agent’s first run' }
          : { status: 'empty', reason: 'Completed tasks carry no usable timing data' };

  const ops = Math.max(telemetry.opsCompleted, derived.completed);
  const emptyLabel = derived.completed === 0 ? 'no ops' : 'n/a';

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
        suppressHydrationWarning
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
          <span className="flex items-center gap-1" title="Model that most recently ran this agent’s work (live session, else last completed task)">
            <span className="uppercase tracking-wider text-muted-foreground/30">Brain</span>
            <TelemetryValue field={brainField} readyCls="text-neon-cyan/80" emptyLabel={emptyLabel} />
          </span>
          <span className="flex items-center gap-1" title="Most recent operation latency (live busy→idle span, else last task’s created→updated span)">
            <span className="uppercase tracking-wider text-muted-foreground/30">Lat</span>
            <TelemetryValue field={latField} readyCls="tabular text-neon-green/80" emptyLabel={emptyLabel} />
          </span>
          <span
            className="flex items-center gap-1"
            title="Completed operations — live session count, backed by this agent’s completed-task history"
          >
            <span className="uppercase tracking-wider text-muted-foreground/30">Ops</span>
            <span className="tabular text-neon-purple/80">{ops}</span>
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

// ---------------------------------------------------------------------------
// Inactive seed group — dormant rows are collapsed out of the live list, not
// mixed into it. Dismissal persists per browser; a restore chip stays visible
// so hidden agents are never silently unreachable.
// ---------------------------------------------------------------------------

const INACTIVE_DISMISS_KEY = 'fleet.inactive.dismissed';

function InactiveGroup({ agents }: { agents: Agent[] }) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // localStorage only after mount — SSR and first client paint must agree.
  useEffect(() => {
    setDismissed(localStorage.getItem(INACTIVE_DISMISS_KEY) === '1');
    setHydrated(true);
  }, []);

  const dismiss = () => {
    localStorage.setItem(INACTIVE_DISMISS_KEY, '1');
    setDismissed(true);
    setOpen(false);
  };
  const restore = () => {
    localStorage.removeItem(INACTIVE_DISMISS_KEY);
    setDismissed(false);
  };

  if (!hydrated || agents.length === 0) return null;

  if (dismissed) {
    return (
      <button
        onClick={restore}
        className="w-full rounded-md border border-dashed border-border/60 px-2 py-1 text-left font-terminal text-[10px] text-muted-foreground/40 transition-colors hover:text-muted-foreground/70"
        aria-label={`${agents.length} inactive agents hidden — show them`}
      >
        <EyeOff className="mr-1 inline size-2.5" aria-hidden /> {agents.length} inactive hidden — show
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-border/60 bg-surface-1/50">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex flex-1 items-center gap-2 text-left"
          title="Seed agents with no heartbeat, no task history, and 0 completed operations — auto-collapsed out of the live fleet"
        >
          <Archive className="size-3 shrink-0 text-muted-foreground/40" aria-hidden />
          <span className="font-terminal text-[10px] uppercase tracking-wider text-muted-foreground/60">
            Inactive ({agents.length})
          </span>
          <span className="hidden text-[9px] text-muted-foreground/35 sm:block">no heartbeat · 0 ops</span>
          <ChevronDown
            className={cn('ml-auto size-3 text-muted-foreground/40 transition-transform duration-200', open && 'rotate-180')}
            aria-hidden
          />
        </button>
        <button
          onClick={dismiss}
          aria-label="Dismiss inactive agents group"
          title="Hide this group (a restore chip stays in its place)"
          className="shrink-0 rounded p-0.5 text-muted-foreground/30 transition-colors hover:text-muted-foreground/70"
        >
          <X className="size-3" />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="space-y-0.5 border-t border-border/40 px-2.5 py-1.5">
              {agents.map((a) => {
                const t = a.type ?? inferAgentType(a.name);
                const Icon = TYPE_ICON[t];
                return (
                  <div key={a.id} className="flex items-center gap-2 py-0.5 font-terminal text-[10px] text-muted-foreground/50">
                    <Icon className={cn('size-2.5 shrink-0 opacity-60', TYPE_COLOR[t])} aria-hidden />
                    <span className="truncate">{a.name}</span>
                    <span className="ml-auto shrink-0 text-[9px] text-muted-foreground/30">
                      {a.last_heartbeat
                        ? `last seen ${formatDistanceToNow(new Date(a.last_heartbeat), { addSuffix: true })}`
                        : 'never active'}
                    </span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface AgentFleetProps {
  initialAgents?: Agent[];
  /** Room filter — 'all' (Control Room) shows the whole fleet; a room scope
   *  keeps only that room's agents (trading membership is earned via
   *  trading-domain task history — see lib/rooms/scope.ts). */
  scope?: RoomScope;
  /** Single-row, high-density layout (name + status + active task inline)
   *  instead of the vertical card grid — used by the Main Dashboard's
   *  Fleet pane. Trading/Coding rooms keep the default card layout. */
  dense?: boolean;
}

/** One compact chip: icon, name, status, and the agent's active task inline
 *  (falls back to a short status word when idle/offline/halted). */
const DenseAgentChip = memo(function DenseAgentChip({
  agent,
  taskDescription,
}: {
  agent: Agent;
  taskDescription: string | null;
}) {
  const agentType = agent.type ?? inferAgentType(agent.name);
  const Icon = TYPE_ICON[agentType];
  const halted = Boolean(agent.halted_at);
  const paused = Boolean(agent.paused) && !halted;

  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-2 rounded-md border border-border bg-surface-1 px-2.5 py-1.5',
        halted && 'border-neon-red/40 bg-neon-red/[0.05]',
        paused && 'opacity-60 saturate-50'
      )}
      title={taskDescription ?? undefined}
    >
      <Icon className={cn('size-3 shrink-0', TYPE_COLOR[agentType])} aria-hidden />
      <StatusDot status={agent.status} size="sm" />
      <span className="shrink-0 text-[11px] font-semibold text-foreground">{agent.name}</span>
      <span className="max-w-[220px] truncate font-terminal text-[10px] text-muted-foreground/60">
        {halted ? 'halted' : paused ? 'paused' : taskDescription ?? (agent.status === 'busy' ? 'working…' : agent.status)}
      </span>
    </div>
  );
});

/** Passive cache reads — TaskFeed / MetricsBar own the realtime channels. */
function useModelLanes(): { lanes: Map<string, ModelLane>; tasks: Task[]; isLoading: boolean; isError: boolean } {
  const { data: tasks = [], isLoading, isError } = useQuery<Task[]>({
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
  return { lanes, tasks, isLoading, isError };
}

export function AgentFleet({ initialAgents = [], scope = 'all', dense = false }: AgentFleetProps) {
  const { data: rawAgents = [], isLoading } = useAgentsQuery(initialAgents);
  const { lanes, tasks, isLoading: tasksLoading, isError: tasksError } = useModelLanes();
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

  // Op counter + model badge from live task completions this session.
  const prevTaskStatusRef = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (tasks.length === 0) return;
    const store = useAgentTelemetryStore.getState();
    const prev = prevTaskStatusRef.current;
    if (prev !== null) {
      for (const t of tasks) {
        const was = prev.get(t.id);
        if (was && was !== 'completed' && t.status === 'completed' && t.agent_id) {
          store.recordCompletion(t.agent_id, t.model ?? null);
        }
      }
    }
    prevTaskStatusRef.current = new Map(tasks.map((t) => [t.id, t.status]));
  }, [tasks]);

  // Brain fallback beyond the 24h metrics window: the newest USAGE metric per
  // agent records the model that actually ran the work even when tasks.model
  // was never written (the common case for worker-run tasks).
  const { data: usageMetrics = [] } = useQuery<Metric[]>({
    queryKey: ['metrics', 'latest-usage'],
    queryFn: async () => {
      const { data, error } = await createClient()
        .from('metrics')
        .select('*')
        .eq('event', 'USAGE')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });

  // Historical per-agent facts from the task + metric tables: brain = model of
  // the newest completed task (else newest USAGE metric), latency = the task's
  // created→updated span, plus a completed count. This is what the BRAIN/LAT
  // cells fall back to, so agents with real history never show an
  // unexplained dash.
  const derivedByAgent = useMemo(() => {
    const map = new Map<string, DerivedTelemetry>();
    for (const t of tasks) {
      if (t.status !== 'completed' || !t.agent_id) continue;
      const entry = map.get(t.agent_id) ?? { ...EMPTY_DERIVED };
      entry.completed += 1;
      if (entry.model === null && t.model) entry.model = t.model; // newest-first
      if (entry.spanMs === null && t.updated_at) {
        const span = parseUtcMs(t.updated_at) - parseUtcMs(t.created_at);
        if (Number.isFinite(span) && span > 0) entry.spanMs = span;
      }
      map.set(t.agent_id, entry);
    }
    for (const m of usageMetrics) {
      if (!m.agent_id || !m.model) continue;
      const entry = map.get(m.agent_id);
      if (entry && entry.model === null) entry.model = m.model; // newest-first
    }
    return map;
  }, [tasks, usageMetrics]);

  const historical = snapshotAt !== null;
  const timeFiltered = historical
    ? rawAgents.filter((a) => new Date(a.created_at).getTime() <= snapshotAt)
    : rawAgents;

  const visibleAgents = useMemo(() => {
    if (scope === 'all') return timeFiltered;
    const tradingIds = tradingAgentIdsFromTasks(tasks);
    return timeFiltered.filter((a) => agentInScope(a, scope, tradingIds));
  }, [timeFiltered, scope, tasks]);

  const { active, inactive } = useMemo(
    () => partitionFleet(visibleAgents, (id) => (derivedByAgent.get(id)?.completed ?? 0) > 0),
    [visibleAgents, derivedByAgent]
  );

  const counts = active.reduce((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Active task description per agent, for the dense inline row — sourced
  // from the same `tasks` list useModelLanes() already fetched.
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  if (dense) {
    return (
      <div className={cn('flex h-full flex-col gap-2', historical && 'opacity-90 saturate-[0.6]')}>
        <div className="flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Fleet</span>
            {!isLoading && (
              <span className="font-terminal text-[10px] text-muted-foreground/40">({active.length})</span>
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
        <div className="flex-1 overflow-x-auto">
          {isLoading ? (
            <div className="flex gap-1.5">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-40 shrink-0 rounded-md" />)}
            </div>
          ) : active.length === 0 ? (
            <div className="flex h-8 items-center">
              <span className="font-terminal text-xs text-muted-foreground/30">
                {scope === 'all' ? 'No agents registered' : 'No agents assigned to this room yet'}
              </span>
            </div>
          ) : (
            <div className="flex gap-1.5">
              {active.map((agent) => (
                <DenseAgentChip
                  key={agent.id}
                  agent={agent}
                  taskDescription={agent.current_task_id ? taskById.get(agent.current_task_id)?.description ?? null : null}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex h-full flex-col gap-2.5', historical && 'opacity-90 saturate-[0.6]')}>
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Fleet</span>
          {!isLoading && (
            <span className="font-terminal text-[10px] text-muted-foreground/40" title="Active agents (inactive seeds are grouped below)">
              ({active.length})
            </span>
          )}
          {!isLoading && inactive.length > 0 && (
            <span className="font-terminal text-[10px] text-muted-foreground/25">+{inactive.length} inactive</span>
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
          ) : active.length === 0 && inactive.length === 0 ? (
            <div className="flex h-32 items-center justify-center">
              <span className="font-terminal text-xs text-muted-foreground/30">
                {scope === 'all' ? 'No agents registered' : 'No agents assigned to this room yet'}
              </span>
            </div>
          ) : (
            <>
              <AnimatePresence mode="popLayout" initial={false}>
                {active.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    lane={lanes.get(agent.id) ?? null}
                    derived={derivedByAgent.get(agent.id) ?? EMPTY_DERIVED}
                    telemetryLoading={tasksLoading}
                    telemetryError={tasksError}
                  />
                ))}
              </AnimatePresence>
              <InactiveGroup agents={inactive} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

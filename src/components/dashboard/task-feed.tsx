'use client';

import { memo, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, Check, Ban, ChevronDown, Layers, Loader2 } from 'lucide-react';
import { useTasksQuery } from '@/hooks/use-tasks-query';
import { AGENTS_KEY } from '@/hooks/use-agents-query';
import { createClient } from '@/lib/supabase/client';
import { useSnapshotAt } from '@/lib/scrubber/scrubber-store';
import { decideIntervention } from '@/lib/control/actions';
import { shortModel } from '@/lib/telemetry/pricing';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { Agent, Task, TaskStatus } from '@/lib/types/database.types';
import { splitObjective, type TaskRunGroup } from '@/lib/types/control-room.types';
import { roomsByAgentId, taskInScope, type RoomScope } from '@/lib/rooms/scope';
import { formatDistanceToNow } from 'date-fns';

const STATUS_VARIANT: Record<TaskStatus, 'success' | 'cyan' | 'muted' | 'error' | 'warning'> = {
  completed: 'success',
  running:   'cyan',
  pending:   'warning',
  failed:    'error',
  cancelled: 'muted',
};

const STATUS_DOT: Record<TaskStatus, string> = {
  completed: 'bg-neon-green',
  running:   'bg-neon-cyan animate-pulse',
  pending:   'bg-warning/60',
  failed:    'bg-neon-red',
  cancelled: 'bg-muted-foreground/30',
};

// Human-in-the-loop intercept. Freezes the row and demands an explicit
// Approve/Deny decision before the agent may proceed.
const ApprovalIntercept = memo(function ApprovalIntercept({ task }: { task: Task }) {
  const qc = useQueryClient();
  const [feedback, setFeedback] = useState('');
  const [pending, setPending] = useState<null | 'approve' | 'deny'>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: 'approve' | 'deny') => {
    setPending(decision);
    setError(null);
    try {
      await decideIntervention(task.id, decision, feedback.trim() || undefined);
      await qc.invalidateQueries();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
      setPending(null);
    }
  };

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-md border border-neon-orange/50 bg-neon-orange/[0.07] px-3 py-2.5 shadow-[0_0_12px_rgba(255,160,40,0.12)]"
    >
      <div className="flex items-center gap-1.5 text-neon-orange">
        <ShieldAlert className="size-3.5 shrink-0" />
        <span className="font-terminal text-[10px] font-bold uppercase tracking-[0.15em]">Approval required</span>
      </div>

      <p className="mt-1.5 text-xs leading-snug text-foreground/90">{task.description}</p>
      {task.intervention_request && (
        <p className="mt-1 rounded bg-surface-2 px-2 py-1 font-terminal text-[10px] text-neon-orange/90">
          ⤷ {task.intervention_request}
        </p>
      )}

      <input
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        suppressHydrationWarning={true}
        placeholder="Optional feedback / instruction…"
        className="mt-2 w-full rounded border border-border bg-surface-1 px-2 py-1 font-terminal text-[10px] text-foreground placeholder:text-muted-foreground/25 outline-none focus:border-neon-orange/40"
      />

      {error && <p className="mt-1 font-terminal text-[10px] text-neon-red">{error}</p>}

      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={() => decide('approve')}
          disabled={pending !== null}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-neon-green/40 bg-neon-green/10 py-1.5 font-terminal text-[10px] font-bold uppercase tracking-wider text-neon-green transition-colors hover:bg-neon-green/20 disabled:opacity-50"
        >
          {pending === 'approve' ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
          Approve
        </button>
        <button
          onClick={() => decide('deny')}
          disabled={pending !== null}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-neon-red/40 bg-neon-red/10 py-1.5 font-terminal text-[10px] font-bold uppercase tracking-wider text-neon-red transition-colors hover:bg-neon-red/20 disabled:opacity-50"
        >
          {pending === 'deny' ? <Loader2 className="size-3 animate-spin" /> : <Ban className="size-3" />}
          Deny
        </button>
      </div>
    </motion.div>
  );
});

const TaskRow = memo(function TaskRow({ task }: { task: Task }) {
  const halted = Boolean(task.halted_at);
  const ts = task.created_at
    ? formatDistanceToNow(new Date(task.created_at), { addSuffix: true, includeSeconds: true })
    : '—';

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ duration: 0.15 }}
      className={cn(
        'group flex items-start gap-3 rounded-md px-3 py-2 border transition-colors duration-150',
        halted
          ? 'border-neon-red/30 bg-neon-red/[0.05]'
          : 'border-transparent hover:border-border hover:bg-surface-1'
      )}
    >
      <div className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', halted ? 'bg-neon-red' : STATUS_DOT[task.status])} />
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-xs text-foreground/85 leading-snug line-clamp-2">{task.description}</p>
        <div className="flex items-center gap-2 flex-wrap">
          {halted ? (
            <Badge variant="error">halted</Badge>
          ) : (
            <Badge variant={STATUS_VARIANT[task.status]}>{task.status}</Badge>
          )}
          {task.intervention_state === 'denied' && (
            <span className="font-terminal text-[9px] uppercase tracking-wider text-neon-red/60">denied</span>
          )}
          <span className="font-terminal text-[10px] text-muted-foreground/40 ml-auto tabular">{ts}</span>
        </div>
      </div>
    </motion.div>
  );
});

// ---------------------------------------------------------------------------
// Matrix run card: N tasks sharing one objective, fanned out across agents,
// collapsed into a single expandable card with a status rollup — never N
// near-identical rows.
// ---------------------------------------------------------------------------

function buildRunGroups(tasks: Task[]): Array<{ kind: 'group'; group: TaskRunGroup } | { kind: 'single'; task: Task }> {
  // Group by the SHARED objective — matrix runs embed their routing tag in
  // the description ("[MATRIX:DEBATE:SCOUT] analyze …"), so the tag is
  // stripped for the key and resurfaced on each sub-row instead.
  const byObjective = new Map<string, Task[]>();
  for (const t of tasks) {
    const key = splitObjective(t.description).objective;
    const list = byObjective.get(key);
    if (list) list.push(t);
    else byObjective.set(key, [t]);
  }

  const out: Array<{ kind: 'group'; group: TaskRunGroup } | { kind: 'single'; task: Task }> = [];
  const grouped = new Set<string>();
  for (const t of tasks) {
    const key = splitObjective(t.description).objective;
    if (grouped.has(key)) continue;
    const members = byObjective.get(key)!;
    if (members.length < 2) {
      out.push({ kind: 'single', task: t });
      continue;
    }
    grouped.add(key);
    out.push({
      kind: 'group',
      group: {
        objective: key,
        tasks: members,
        rollup: {
          total: members.length,
          completed: members.filter((m) => m.status === 'completed').length,
          running: members.filter((m) => m.status === 'running').length,
          failed: members.filter((m) => m.status === 'failed').length,
          pending: members.filter((m) => m.status === 'pending').length,
          cancelled: members.filter((m) => m.status === 'cancelled').length,
        },
      },
    });
  }
  return out;
}

const TaskRunCard = memo(function TaskRunCard({
  group,
  agentName,
}: {
  group: TaskRunGroup;
  agentName: (id: string | null) => string;
}) {
  const [open, setOpen] = useState(false);
  const { rollup } = group;
  const allDone = rollup.completed === rollup.total;
  const anyFailed = rollup.failed > 0;
  const anyRunning = rollup.running > 0;

  const dotCls = anyFailed
    ? 'bg-neon-red'
    : anyRunning
      ? 'bg-neon-cyan animate-pulse'
      : allDone
        ? 'bg-neon-green'
        : 'bg-warning/60';

  const newest = group.tasks.reduce((max, t) => Math.max(max, Date.parse(t.created_at)), 0);

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ duration: 0.15 }}
      className="rounded-md border border-border/70 bg-surface-1/60"
    >
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-1"
        title={`Matrix run — the same objective dispatched to ${rollup.total} agents. Expand for per-agent results.`}
      >
        <div className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', dotCls)} aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs leading-snug text-foreground/85 line-clamp-2">{group.objective}</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 font-terminal text-[9px] uppercase tracking-wider text-neon-purple/80">
              <Layers className="size-2.5" aria-hidden /> matrix run
            </span>
            <Badge variant={anyFailed ? 'error' : allDone ? 'success' : anyRunning ? 'cyan' : 'warning'}>
              {rollup.completed}/{rollup.total} complete
            </Badge>
            {rollup.failed > 0 && (
              <span className="font-terminal text-[9px] uppercase tracking-wider text-neon-red/70">
                {rollup.failed} failed
              </span>
            )}
            <span className="ml-auto font-terminal text-[10px] tabular text-muted-foreground/40">
              {newest > 0 ? formatDistanceToNow(newest, { addSuffix: true, includeSeconds: true }) : '—'}
            </span>
          </div>
        </div>
        <ChevronDown
          className={cn('mt-1 size-3 shrink-0 text-muted-foreground/40 transition-transform duration-200', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="space-y-0.5 border-t border-border/40 px-3 py-1.5">
              {group.tasks.map((t) => {
                const { tag } = splitObjective(t.description);
                return (
                  <div key={t.id} className="flex items-center gap-2 py-1 font-terminal text-[10px]">
                    <div className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[t.status])} aria-hidden />
                    <span className="truncate text-foreground/75">{agentName(t.agent_id)}</span>
                    {tag && <span className="hidden shrink-0 text-[9px] uppercase tracking-wide text-neon-purple/50 sm:block">{tag}</span>}
                    {t.model && <span className="shrink-0 text-muted-foreground/40">{shortModel(t.model)}</span>}
                    <Badge variant={STATUS_VARIANT[t.status]}>{t.status}</Badge>
                    <span className="ml-auto shrink-0 tabular text-muted-foreground/35">
                      {formatDistanceToNow(new Date(t.created_at), { addSuffix: true, includeSeconds: true })}
                    </span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});

function TaskSkeleton() {
  return (
    <div className="px-3 py-2 space-y-2">
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-3/4" />
      <Skeleton className="h-4 w-16 rounded" />
    </div>
  );
}

export function TaskFeed({ initialTasks = [], scope = 'all' }: { initialTasks?: Task[]; scope?: RoomScope }) {
  const { data: rawTasks = [], isLoading } = useTasksQuery(initialTasks);
  const snapshotAt = useSnapshotAt();
  const historical = snapshotAt !== null;

  // Passive cache read for agent names on matrix sub-rows.
  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: AGENTS_KEY,
    queryFn: async () => {
      const { data, error } = await createClient().from('agents').select('*').order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });
  const agentName = useMemo(() => {
    const byId = new Map(agents.map((a) => [a.id, a.name]));
    return (id: string | null) => (id ? byId.get(id) ?? `agent ${id.slice(0, 8)}…` : 'unassigned');
  }, [agents]);

  // In historical mode, show only tasks that existed at the snapshot instant;
  // in a room, show only that room's tasks (agent membership or domain match).
  const timeFiltered = historical
    ? rawTasks.filter((t) => new Date(t.created_at).getTime() <= snapshotAt)
    : rawTasks;
  const tasks = useMemo(() => {
    if (scope === 'all') return timeFiltered;
    const byAgent = roomsByAgentId(agents);
    return timeFiltered.filter((t) => taskInScope(t, scope, byAgent));
  }, [timeFiltered, scope, agents]);

  // Approval intercepts always render standalone — a frozen decision row must
  // never be buried inside a collapsed group.
  const intercepts = !historical ? tasks.filter((t) => t.intervention_state === 'pending_approval') : [];
  const groupable = tasks.filter((t) => !intercepts.includes(t));
  const rows = useMemo(() => buildRunGroups(groupable), [groupable]);

  const pending = tasks.filter((t) => t.status === 'pending').length;
  const running = tasks.filter((t) => t.status === 'running').length;

  return (
    <div className={cn('flex h-full flex-col gap-2.5', historical && 'opacity-90 saturate-[0.6]')}>
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Tasks</span>
          {!isLoading && (
            <span className="font-terminal text-[10px] text-muted-foreground/40" title={`${tasks.length} tasks in ${rows.length} rows (matrix runs grouped)`}>
              ({tasks.length})
            </span>
          )}
          {intercepts.length > 0 && (
            <span className="font-terminal text-[10px] text-neon-orange animate-glow-pulse">{intercepts.length} awaiting</span>
          )}
        </div>
        {!isLoading && (pending > 0 || running > 0) && (
          <div className="flex items-center gap-2 font-terminal text-[10px]">
            {running > 0 && <span className="text-neon-cyan">{running} running</span>}
            {pending > 0 && <span className="text-warning">{pending} pending</span>}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto -mx-1">
        <div className="px-1 space-y-0.5">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <TaskSkeleton key={i} />)
          ) : tasks.length === 0 ? (
            <div className="flex h-32 items-center justify-center">
              <span className="font-terminal text-xs text-muted-foreground/30">No tasks dispatched yet</span>
            </div>
          ) : (
            <AnimatePresence mode="popLayout" initial={false}>
              {intercepts.map((task) => (
                <ApprovalIntercept key={task.id} task={task} />
              ))}
              {rows.map((row) =>
                row.kind === 'group' ? (
                  <TaskRunCard key={`run:${row.group.objective}`} group={row.group} agentName={agentName} />
                ) : (
                  <TaskRow key={row.task.id} task={row.task} />
                )
              )}
            </AnimatePresence>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

import { memo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, Check, Ban, Loader2 } from 'lucide-react';
import { useTasksQuery } from '@/hooks/use-tasks-query';
import { useSnapshotAt } from '@/lib/scrubber/scrubber-store';
import { decideIntervention } from '@/lib/control/actions';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { Task, TaskStatus } from '@/lib/types/database.types';
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

const TaskRow = memo(function TaskRow({ task, readOnly }: { task: Task; readOnly: boolean }) {
  if (!readOnly && task.intervention_state === 'pending_approval') {
    return <ApprovalIntercept task={task} />;
  }

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

function TaskSkeleton() {
  return (
    <div className="px-3 py-2 space-y-2">
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-3/4" />
      <Skeleton className="h-4 w-16 rounded" />
    </div>
  );
}

export function TaskFeed({ initialTasks = [] }: { initialTasks?: Task[] }) {
  const { data: allTasks = [], isLoading } = useTasksQuery(initialTasks);
  const snapshotAt = useSnapshotAt();
  const historical = snapshotAt !== null;

  // In historical mode, show only tasks that existed at the snapshot instant.
  const tasks = historical
    ? allTasks.filter((t) => new Date(t.created_at).getTime() <= snapshotAt)
    : allTasks;

  const pending = tasks.filter((t) => t.status === 'pending').length;
  const running = tasks.filter((t) => t.status === 'running').length;
  const awaiting = tasks.filter((t) => t.intervention_state === 'pending_approval').length;

  return (
    <div className={cn('flex h-full flex-col gap-2.5', historical && 'opacity-90 saturate-[0.6]')}>
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Tasks</span>
          {!isLoading && (
            <span className="font-terminal text-[10px] text-muted-foreground/40">({tasks.length})</span>
          )}
          {awaiting > 0 && !historical && (
            <span className="font-terminal text-[10px] text-neon-orange animate-glow-pulse">{awaiting} awaiting</span>
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
              {tasks.map((task) => (
                <TaskRow key={task.id} task={task} readOnly={historical} />
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>
    </div>
  );
}

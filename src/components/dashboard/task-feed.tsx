'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useTasksQuery } from '@/hooks/use-tasks-query';
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

function PriorityBar({ priority }: { priority: number }) {
  const filled = Math.round((priority / 10) * 5);
  return (
    <div className="flex items-center gap-0.5" title={`Priority ${priority}/10`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <motion.div
          key={i}
          initial={{ scaleY: 0 }}
          animate={{ scaleY: 1 }}
          transition={{ delay: i * 0.05, type: 'spring', stiffness: 300 }}
          className={cn(
            'h-2 w-1 rounded-sm origin-bottom',
            i < filled ? 'bg-primary' : 'bg-surface-3'
          )}
        />
      ))}
    </div>
  );
}

function TaskRow({ task, index }: { task: Task; index: number }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ type: 'spring', stiffness: 350, damping: 28, delay: index * 0.03 }}
      className={cn(
        'group flex items-start gap-3 rounded-md px-3 py-2.5',
        'border border-transparent hover:border-border hover:bg-surface-1',
        'transition-colors duration-150'
      )}
    >
      <div className="flex-1 min-w-0 space-y-1.5">
        <p className="text-xs text-foreground/85 leading-snug line-clamp-2">{task.description}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={STATUS_VARIANT[task.status]}>{task.status}</Badge>
          <PriorityBar priority={task.priority} />
          <span className="font-terminal text-[10px] text-muted-foreground/40 ml-auto tabular">
            {formatDistanceToNow(new Date(task.created_at), { addSuffix: true, includeSeconds: true })}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

function TaskSkeleton({ i }: { i: number }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: i * 0.07 }}
      className="px-3 py-2.5 space-y-2"
    >
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-3/4" />
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-16 rounded" />
        <Skeleton className="h-2 w-12" />
      </div>
    </motion.div>
  );
}

export function TaskFeed({ initialTasks = [] }: { initialTasks?: Task[] }) {
  const { data: tasks = [], isLoading } = useTasksQuery(initialTasks);

  const pending = tasks.filter((t) => t.status === 'pending').length;
  const running = tasks.filter((t) => t.status === 'running').length;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Tasks</span>
          {!isLoading && (
            <span className="font-terminal text-[10px] text-muted-foreground/40">({tasks.length})</span>
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
          <AnimatePresence mode="popLayout" initial={false}>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => <TaskSkeleton key={i} i={i} />)
              : tasks.map((task, i) => (
                  <TaskRow key={task.id} task={task} index={i} />
                ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

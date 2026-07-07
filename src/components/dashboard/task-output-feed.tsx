'use client';

import { memo, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { AGENTS_KEY } from '@/hooks/use-agents-query';
import { TASKS_KEY } from '@/hooks/use-tasks-query';
import { createClient } from '@/lib/supabase/client';
import { shortModel } from '@/lib/telemetry/pricing';
import { splitObjective } from '@/lib/types/control-room.types';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { Agent, AgentType, Task } from '@/lib/types/database.types';
import { formatDistanceToNow } from 'date-fns';

interface TaskResultPayload {
  chars?: number;
  model?: string;
  preview?: string;
  streaming?: boolean;
  matrix?: { role?: string; phase?: string };
}

/** Line-level highlight for diff-shaped output; prose renders normally. */
function outputLineCls(line: string): string {
  if (/^\+(?!\+\+)/.test(line)) return 'text-neon-green/80';
  if (/^-(?!--)/.test(line)) return 'text-neon-red/70';
  if (/^@@/.test(line)) return 'text-neon-cyan/70';
  return 'text-foreground/70';
}

const OutputCard = memo(function OutputCard({
  task,
  agentName,
  accent,
}: {
  task: Task;
  agentName: string;
  accent: string;
}) {
  const [open, setOpen] = useState(false);
  const r = (task.result ?? {}) as TaskResultPayload;
  const preview = r.preview ?? '';
  const { objective } = splitObjective(task.description);

  return (
    <div className="rounded-md border border-border/70 bg-surface-1/60">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-1"
      >
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-xs text-foreground/85">{objective}</p>
          <div className="flex flex-wrap items-center gap-2 font-terminal text-[10px]">
            <span className={cn('font-semibold', accent)}>{agentName}</span>
            {r.matrix?.role && <span className="text-neon-purple/60 uppercase text-[9px]">{r.matrix.role}</span>}
            {(r.model ?? task.model) && <span className="text-muted-foreground/40">{shortModel(r.model ?? task.model!)}</span>}
            {r.streaming ? <Badge variant="cyan">streaming</Badge> : <Badge variant="success">{task.status}</Badge>}
            <span className="ml-auto tabular text-muted-foreground/35">
              {formatDistanceToNow(new Date(task.updated_at ?? task.created_at), { addSuffix: true })}
            </span>
          </div>
        </div>
        <ChevronDown className={cn('mt-1 size-3 shrink-0 text-muted-foreground/40 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>

      {open && (
        <div className="border-t border-border/40 px-3 py-2">
          {preview ? (
            <>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-terminal text-[10px] leading-relaxed">
                {preview.split('\n').map((line, i) => (
                  <div key={i} className={outputLineCls(line)}>
                    {line}
                  </div>
                ))}
              </pre>
              {typeof r.chars === 'number' && r.chars > preview.length && (
                <p
                  className="mt-1 font-terminal text-[9px] text-muted-foreground/40"
                  title="Workers persist a rolling preview window of the output stream, not the full transcript"
                >
                  rolling preview — {preview.length} of {r.chars} chars retained
                </p>
              )}
            </>
          ) : (
            <p className="font-terminal text-[10px] text-muted-foreground/40" title="The task completed but its worker did not persist an output preview">
              no output preview was recorded for this task
            </p>
          )}
        </div>
      )}
    </div>
  );
});

/**
 * Latest real outputs for a set of agent types, straight from tasks.result
 * (the workers' persisted preview windows). The Coding Room renders this as
 * the code review panel (with diff-line highlighting); the Research Room as
 * the findings feed.
 */
export function TaskOutputFeed({
  agentTypes,
  title,
  accent,
  emptyText,
}: {
  agentTypes: AgentType[];
  title: string;
  accent: string;
  emptyText: string;
}) {
  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: AGENTS_KEY,
    queryFn: async () => {
      const { data, error } = await createClient().from('agents').select('*').order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });
  const { data: tasks = [], isLoading } = useQuery<Task[]>({
    queryKey: TASKS_KEY,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from('tasks').select('*').order('created_at', { ascending: false }).limit(20);
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });

  const rows = useMemo(() => {
    const wanted = new Set<string>(
      agents.filter((a) => agentTypes.includes(a.type ?? 'generic')).map((a) => a.id)
    );
    const nameById = new Map(agents.map((a) => [a.id, a.name]));
    return tasks
      .filter((t) => t.agent_id && wanted.has(t.agent_id) && (t.status === 'completed' || t.status === 'running'))
      .slice(0, 8)
      .map((t) => ({ task: t, agentName: nameById.get(t.agent_id!) ?? 'agent' }));
  }, [agents, tasks, agentTypes]);

  return (
    <section className="min-w-0">
      <h2 className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">{title}</h2>
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full rounded-md" />
          <Skeleton className="h-12 w-full rounded-md" />
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 font-terminal text-[10px] text-muted-foreground/40">
          {emptyText}
        </p>
      ) : (
        <div className="space-y-1.5">
          {rows.map(({ task, agentName }) => (
            <OutputCard key={task.id} task={task} agentName={agentName} accent={accent} />
          ))}
        </div>
      )}
    </section>
  );
}

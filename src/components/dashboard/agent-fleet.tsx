'use client';

import { memo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Code2, Search, Globe, Layers, ChevronDown } from 'lucide-react';
import { useAgentsQuery } from '@/hooks/use-agents-query';
import { StatusDot } from './status-dot';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { Agent, AgentType } from '@/lib/types/database.types';
import { formatDistanceToNow } from 'date-fns';
import { useSnapshotAt } from '@/lib/scrubber/scrubber-store';

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
const AgentCard = memo(function AgentCard({ agent }: { agent: Agent }) {
  const [expanded, setExpanded] = useState(false);
  const agentType = inferAgentType(agent.name);
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
        className={cn(
          'group relative rounded-lg border border-border bg-surface-1',
          'cursor-pointer transition-colors duration-150',
          'hover:border-border/80 hover:bg-surface-2',
          agent.status === 'busy'  && 'border-neon-cyan/20',
          agent.status === 'error' && 'border-neon-red/20',
          paused && 'border-neon-orange/30',
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
          <span className="font-terminal text-[10px] text-muted-foreground/40 tabular">{since}</span>
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

export function AgentFleet({ initialAgents = [] }: AgentFleetProps) {
  const { data: rawAgents = [], isLoading } = useAgentsQuery(initialAgents);
  const snapshotAt = useSnapshotAt();
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
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>
    </div>
  );
}

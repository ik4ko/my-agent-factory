'use client';

import { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Activity, CheckCircle2, Clock, Coins, DollarSign, Gauge, ScrollText, Zap, type LucideIcon } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useMetricsQuery } from '@/hooks/use-metrics-query';
import { AGENTS_KEY } from '@/hooks/use-agents-query';
import { TASKS_KEY } from '@/hooks/use-tasks-query';
import { LOGS_KEY } from '@/hooks/use-logs-query';
import { createClient } from '@/lib/supabase/client';
import { FABLE_SHARE_CAP } from '@/lib/agents/model-router';
import { summarizeSpend, shortModel } from '@/lib/telemetry/pricing';
import { useSnapshotAt } from '@/lib/scrubber/scrubber-store';
import { partitionFleet } from '@/lib/types/control-room.types';
import type { Agent, Task, Log } from '@/lib/types/database.types';
import { cn } from '@/lib/utils';

function fmtTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

/** Single metric cell: value never renders without a visible label + unit and
 *  a hover/focus tooltip explaining exactly what it measures. */
const MetricCell = memo(function MetricCell({
  icon: Icon,
  label,
  value,
  unit,
  tooltip,
  color,
  loading,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  unit?: string;
  tooltip: string;
  color: string;
  loading?: boolean;
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-1.5 rounded px-1.5 py-0.5"
      title={tooltip}
      aria-label={`${label}: ${loading ? 'loading' : value}${unit ? ` ${unit}` : ''}. ${tooltip}`}
    >
      <Icon className={cn('size-3 shrink-0', color)} aria-hidden />
      <span className={cn('font-terminal text-xs tabular font-semibold', color)}>{loading ? '…' : value}</span>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
        {label}
        {unit ? <span className="text-muted-foreground/35">&nbsp;{unit}</span> : null}
      </span>
    </div>
  );
});

/**
 * Fable-5 allocation meter vs the 20% network-share cap.
 * < 75% of cap → emerald · 75–95% → amber glow · ≥ 95% → red flash.
 */
const FableMeter = memo(function FableMeter({ share }: { share: number }) {
  const pctOfCap = share / FABLE_SHARE_CAP; // 1.0 == at the cap
  const level = pctOfCap >= 0.95 ? 'critical' : pctOfCap >= 0.75 ? 'warning' : 'ok';
  const tooltip =
    `Share of the last 24h token spend routed to the Fable-5 model: ${(share * 100).toFixed(1)}%. ` +
    `The model router enforces a ${FABLE_SHARE_CAP * 100}% network-share cap (FABLE_SHARE_CAP) — ` +
    `the bar spans 0% to that cap; amber from 75% of cap, red from 95%.`;

  return (
    <div className="flex min-w-0 items-center gap-2" title={tooltip} aria-label={tooltip}>
      <Gauge
        aria-hidden
        className={cn(
          'size-3 shrink-0',
          level === 'ok' && 'text-neon-green',
          level === 'warning' && 'text-neon-orange animate-glow-pulse',
          level === 'critical' && 'text-neon-red animate-glow-pulse'
        )}
      />
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
        Fable-5&nbsp;24h&nbsp;share
      </span>
      <div className="relative h-1.5 w-24 overflow-hidden rounded-full bg-surface-3 sm:w-32">
        <motion.div
          className={cn(
            'absolute inset-y-0 left-0 rounded-full',
            level === 'ok' && 'bg-neon-green/80',
            level === 'warning' && 'bg-neon-orange shadow-neon-sm animate-glow-pulse',
            level === 'critical' && 'bg-neon-red shadow-neon-red animate-glow-pulse'
          )}
          initial={false}
          animate={{ width: `${Math.min(pctOfCap, 1) * 100}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        />
      </div>
      <span
        className={cn(
          'font-terminal text-xs tabular font-semibold',
          level === 'ok' && 'text-neon-green',
          level === 'warning' && 'text-neon-orange',
          level === 'critical' && 'text-neon-red animate-glow-pulse'
        )}
      >
        {(share * 100).toFixed(1)}%
      </span>
      <span className="font-terminal text-[10px] text-muted-foreground/40">of {FABLE_SHARE_CAP * 100}% cap</span>
    </div>
  );
});

/**
 * The ONE metrics strip for the Control Room. Absorbs the former StatsBar so
 * fleet counters, task counters, log rate, token spend, and the Fable cap
 * meter read as a single designed system — every figure labeled, united, and
 * explained on hover. Passive cache reads; the panels own the realtime
 * channels.
 */
export function MetricsBar() {
  const { data: metrics = [], isLoading: metricsLoading } = useMetricsQuery();
  const spend = useMemo(() => summarizeSpend(metrics), [metrics]);
  const snapshotAt = useSnapshotAt();

  const { data: rawAgents = [] } = useQuery<Agent[]>({
    queryKey: AGENTS_KEY,
    queryFn: async () => {
      const { data, error } = await createClient().from('agents').select('*').order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });
  const { data: rawTasks = [] } = useQuery<Task[]>({
    queryKey: TASKS_KEY,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from('tasks').select('*').order('created_at', { ascending: false }).limit(20);
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });
  const { data: rawLogs = [] } = useQuery<Log[]>({
    queryKey: LOGS_KEY,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from('logs').select('*').order('timestamp', { ascending: false }).limit(80);
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });

  // Snapshot mode: derive counters only from entities existing at the instant.
  const allAgents = snapshotAt === null ? rawAgents : rawAgents.filter((a) => Date.parse(a.created_at) <= snapshotAt);
  const tasks = snapshotAt === null ? rawTasks : rawTasks.filter((t) => Date.parse(t.created_at) <= snapshotAt);
  const logs = snapshotAt === null ? rawLogs : rawLogs.filter((l) => Date.parse(l.timestamp) <= snapshotAt);

  // Same dedupe rule as the fleet panel: dormant seed agents never inflate
  // the health counters here while being collapsed out of the list there.
  const completedByAgent = new Set(tasks.filter((t) => t.status === 'completed' && t.agent_id).map((t) => t.agent_id as string));
  const { active: agents, inactive } = partitionFleet(allAgents, (id) => completedByAgent.has(id));

  const idle = agents.filter((a) => a.status === 'idle').length;
  const busy = agents.filter((a) => a.status === 'busy').length;
  const errored = agents.filter((a) => a.status === 'error').length;
  const pending = tasks.filter((t) => t.status === 'pending').length;
  const running = tasks.filter((t) => t.status === 'running').length;
  const completed = tasks.filter((t) => t.status === 'completed').length;

  const cutoff = Date.now() - 60_000;
  const logRate = logs.filter((l) => Date.parse(l.timestamp) > cutoff).length;

  const perModel = Object.entries(spend.byModel)
    .filter(([, v]) => v.tokens > 0)
    .sort((a, b) => b[1].tokens - a[1].tokens);

  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-surface-1/60 px-2 py-1',
        snapshotAt !== null && 'border-neon-purple/30 bg-neon-purple/[0.04]'
      )}
    >
      {/* fleet health */}
      <MetricCell icon={Activity} label="idle" unit="agents" value={String(idle)} color="text-neon-green"
        tooltip={`Active agents currently idle and available for dispatch${inactive.length > 0 ? ` (excludes ${inactive.length} dormant seed agents — see the fleet panel's Inactive group)` : ''}.`} />
      <MetricCell icon={Zap} label="busy" unit="agents" value={String(busy)} color="text-neon-cyan"
        tooltip="Agents currently executing a task." />
      {errored > 0 && (
        <MetricCell icon={Activity} label="error" unit="agents" value={String(errored)} color="text-neon-red"
          tooltip="Agents in an error state — inspect the fleet panel." />
      )}

      <div className="mx-1.5 h-4 w-px shrink-0 bg-border/50" aria-hidden />

      {/* task pipeline */}
      <MetricCell icon={Clock} label="pending" unit="tasks" value={String(pending)} color="text-warning"
        tooltip="Tasks queued and waiting for an agent." />
      <MetricCell icon={Zap} label="running" unit="tasks" value={String(running)} color="text-neon-cyan"
        tooltip="Tasks currently executing." />
      <MetricCell icon={CheckCircle2} label="done" unit="tasks" value={String(completed)} color="text-neon-green/60"
        tooltip="Tasks completed (within the 20 most recent)." />

      <div className="mx-1.5 h-4 w-px shrink-0 bg-border/50" aria-hidden />

      {/* activity + spend */}
      <MetricCell icon={ScrollText} label="log rate" unit="lines/min" value={String(logRate)} color="text-foreground/70"
        tooltip="System log lines written in the last 60 seconds, across all agents. Proof-of-life heartbeats are included here but hidden by default in the Live Terminal." />
      <MetricCell icon={Coins} label="tokens" unit="24h" value={fmtTokens(spend.totalTokens)} color="text-neon-cyan"
        loading={metricsLoading}
        tooltip="Total LLM tokens (input + output) consumed across all models in the last 24 hours." />
      <MetricCell icon={DollarSign} label="est cost" unit="USD 24h" value={spend.totalCostUsd.toFixed(spend.totalCostUsd >= 10 ? 2 : 3)}
        color="text-neon-green" loading={metricsLoading}
        tooltip="Estimated 24h spend in USD, computed from per-model token pricing. Estimate only — not a billing figure." />

      {/* per-model breakdown chips */}
      <div className="hidden items-center gap-1.5 lg:flex">
        {perModel.map(([model, v]) => (
          <span
            key={model}
            title={`${model}: ${fmtTokens(v.tokens)} tokens in the last 24h`}
            className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-terminal text-[10px] text-muted-foreground/70"
          >
            {shortModel(model)}&nbsp;{fmtTokens(v.tokens)}
          </span>
        ))}
      </div>

      <div className="ml-auto shrink-0 pl-2">
        <FableMeter share={spend.fableShare} />
      </div>
    </div>
  );
}

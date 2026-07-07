'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { AGENTS_KEY } from '@/hooks/use-agents-query';
import { TASKS_KEY } from '@/hooks/use-tasks-query';
import { LOGS_KEY } from '@/hooks/use-logs-query';
import { createClient } from '@/lib/supabase/client';
import { useRiskState } from '@/hooks/use-risk-state';
import { useSimulationStatus } from '@/hooks/use-simulation-status';
import {
  ROOMS,
  agentInScope,
  logInScope,
  scopeAgentIds,
  tradingAgentIdsFromTasks,
  type RoomDef,
} from '@/lib/rooms/scope';
import { partitionFleet } from '@/lib/types/control-room.types';
import type { Agent, Log, Task } from '@/lib/types/database.types';
import { cn } from '@/lib/utils';

type Health = 'ok' | 'busy' | 'warn' | 'crit';

const DOT: Record<Health, string> = {
  ok: 'bg-neon-green',
  busy: 'bg-neon-cyan animate-pulse',
  warn: 'bg-neon-orange',
  crit: 'bg-neon-red animate-pulse',
};

interface RoomChip {
  room: RoomDef;
  health: Health;
  healthReason: string;
  activity: string;
}

/**
 * Control Room cross-room overview: ONE line per room — health dot, latest
 * activity, link. Sourced from the exact same scope predicates and risk/sim
 * hooks the room pages use, so a chip can never disagree with its room.
 * This replaces the full trading chrome (simulation banner, risk panel) on
 * the Control Room — that now lives in /dashboard/trading.
 */
export function RoomStatusStrip() {
  const { data: risk } = useRiskState();
  const sim = useSimulationStatus();

  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: AGENTS_KEY,
    queryFn: async () => {
      const { data, error } = await createClient().from('agents').select('*').order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });
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
  const { data: logs = [] } = useQuery<Log[]>({
    queryKey: LOGS_KEY,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from('logs').select('*').order('timestamp', { ascending: false }).limit(80);
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });

  const chips: RoomChip[] = useMemo(() => {
    const tradingIds = tradingAgentIdsFromTasks(tasks);
    // Same dormant-seed dedupe as the fleet panel — a chip must never count
    // agents the fleet list has collapsed away.
    const completedByAgent = new Set(tasks.filter((t) => t.status === 'completed' && t.agent_id).map((t) => t.agent_id as string));
    const { active: liveAgents } = partitionFleet(agents, (id) => completedByAgent.has(id));

    return ROOMS.map((room) => {
      const roomAgents = liveAgents.filter((a) => agentInScope(a, room.scope, tradingIds));
      const ids = scopeAgentIds(agents, room.scope, tradingIds);
      // logs cache is newest-first; take the newest non-heartbeat line in scope
      const latestLog = logs.find(
        (l) => logInScope(l, room.scope, ids) && !/heartbeat/i.test(l.message)
      );
      const activity = latestLog ? latestLog.message.replace(/^\[[A-Z]+\]\s*/, '').slice(0, 90) : 'no recent activity';

      let health: Health = 'ok';
      let healthReason = 'nominal';
      if (room.scope === 'trading') {
        if (risk?.killSwitch || risk?.halted) {
          health = 'crit';
          healthReason = risk.killSwitch ? 'kill switch engaged' : `halted — ${risk.haltReason ?? 'unspecified'}`;
        } else if (sim.simulated) {
          health = 'warn';
          healthReason = sim.reason;
        } else {
          healthReason = 'live feed, gate open';
        }
      } else {
        if (roomAgents.some((a) => a.status === 'error' || a.halted_at)) {
          health = 'crit';
          healthReason = 'agent in error/halted state';
        } else if (roomAgents.some((a) => a.status === 'busy')) {
          health = 'busy';
          healthReason = 'agent working';
        } else if (roomAgents.length === 0) {
          health = 'warn';
          healthReason = 'no agents assigned';
        } else {
          healthReason = `${roomAgents.length} agent(s) idle`;
        }
      }

      return { room, health, healthReason, activity };
    });
  }, [agents, tasks, logs, risk, sim.simulated, sim.reason]);

  return (
    <div className="shrink-0 border-b border-border bg-surface-1/40 px-2 py-1" aria-label="Room status overview">
      <div className="flex flex-col gap-0.5 lg:flex-row lg:items-center lg:gap-0 lg:divide-x lg:divide-border/50">
        {chips.map(({ room, health, healthReason, activity }) => (
          <Link
            key={room.scope}
            href={room.href}
            title={`${room.label} room — ${healthReason}. Click to open.`}
            className="group flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-0.5 transition-colors hover:bg-surface-2"
          >
            <span className={cn('size-1.5 shrink-0 rounded-full', DOT[health])} aria-hidden />
            <span className={cn('shrink-0 font-terminal text-[10px] font-semibold uppercase tracking-wider', room.accent)}>
              {room.label}
            </span>
            <span className="truncate font-terminal text-[10px] text-muted-foreground/50">{activity}</span>
            <ArrowRight
              className="ml-auto size-3 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/60"
              aria-hidden
            />
          </Link>
        ))}
      </div>
    </div>
  );
}

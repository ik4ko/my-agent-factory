'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BrainCircuit } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSupabaseRealtime } from '@/hooks/use-supabase-realtime';
import { AGENTS_KEY } from '@/hooks/use-agents-query';
import { useAgentTelemetryStore } from '@/lib/fx/agent-telemetry';
import { cn } from '@/lib/utils';
import { TASKS_KEY } from '@/hooks/use-tasks-query';
import type { Agent, AgentType, SystemBusRow, Task } from '@/lib/types/database.types';

/**
 * Bus observers — shared plumbing for AgentActivity + SystemHealthPill.
 * Both read the same query cache; each mounts its own uniquely-named
 * realtime channel and the cache updater dedupes by id, so double delivery
 * is harmless.
 */

export const BUS_THOUGHTS_KEY = ['system-bus', 'thoughts'] as const;
const THOUGHT_CACHE_SIZE = 12;

export interface ThoughtProvenance {
  provider: string;
  model: string;
  latencyMs: number | null;
  preview: string;
}

export function readProvenance(row: SystemBusRow): ThoughtProvenance {
  const p = row.payload;
  return {
    provider: typeof p.provider === 'string' ? p.provider : 'unknown',
    model: typeof p.model === 'string' ? p.model : '—',
    latencyMs: typeof p.latencyMs === 'number' ? p.latencyMs : null,
    preview: typeof p.preview === 'string' ? p.preview : '',
  };
}

/** Last N agent.thought events, kept live by realtime INSERTs.
 *  Pass `channelName: null` for a CACHE-ONLY consumer: it renders from the
 *  shared query cache that the owning subscriber (AgentActivity) keeps hot —
 *  one socket channel serves every observer. */
export function useBusThoughts(channelName: string | null): SystemBusRow[] {
  const qc = useQueryClient();

  const { data: thoughts = [] } = useQuery<SystemBusRow[]>({
    queryKey: BUS_THOUGHTS_KEY,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from('system_bus')
        .select('*')
        .eq('topic', 'agent.thought')
        .order('created_at', { ascending: false })
        .limit(THOUGHT_CACHE_SIZE);
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });

  // Channel-level topic filter: hand-off events (which carry FULL step
  // outputs in their payloads) never reach the browser at all. The empty
  // channel name disables subscription for cache-only consumers — the hook
  // itself bails safely on empty names.
  useSupabaseRealtime<SystemBusRow>({
    channel: channelName ?? '',
    table: 'system_bus',
    event: 'INSERT',
    filter: 'topic=eq.agent.thought',
    onChange: ({ new: row }) => {
      if (!row || row.topic !== 'agent.thought') return; // defense in depth
      qc.setQueryData<SystemBusRow[]>(BUS_THOUGHTS_KEY, (prev = []) =>
        prev.some((t) => t.id === row.id) ? prev : [row, ...prev].slice(0, THOUGHT_CACHE_SIZE),
      );
    },
  });

  return thoughts;
}

// ---------------------------------------------------------------------------
// Agent Activity strip
// ---------------------------------------------------------------------------

const BRAINS: Array<{ label: string; types: AgentType[] }> = [
  { label: 'Hermes', types: ['generic', 'researcher', 'browser'] },
  { label: 'Codex', types: ['coder'] },
  { label: 'Builder', types: ['planner'] },
];

function providerBadge(provider: string): { label: string; cls: string } {
  if (provider === 'openrouter') return { label: 'OPENROUTER', cls: 'border-neon-cyan/40 text-neon-cyan/80' };
  if (provider === 'anthropic') return { label: 'FALLBACK', cls: 'border-neon-orange/50 text-neon-orange' };
  return { label: provider.toUpperCase(), cls: 'border-border text-muted-foreground/60' };
}

export function AgentActivity() {
  const thoughts = useBusThoughts('bus-observer-activity');

  // Thinking state: a brain is "thinking" when any busy agent routes to it.
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

  const thinking = useMemo(() => {
    const busyTypes = new Set(
      agents.filter((a) => a.status === 'busy').map((a) => a.type ?? 'generic'),
    );
    return BRAINS.map((b) => ({ label: b.label, active: b.types.some((t) => busyTypes.has(t)) }));
  }, [agents]);

  // Bus → fleet card telemetry: map each new agent.thought's provenance
  // (real OpenRouter slug or fallback model + true provider latency) onto
  // the matching agent's BRAIN/LAT strip via the per-agent telemetry store.
  const processedThoughtsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (agents.length === 0 || thoughts.length === 0) return;
    const idByName = new Map(agents.map((a) => [a.name.toLowerCase(), a.id]));
    const store = useAgentTelemetryStore.getState();
    for (const t of thoughts) {
      if (processedThoughtsRef.current.has(t.id)) continue;
      processedThoughtsRef.current.add(t.id);
      const prov = readProvenance(t);
      const agentId = t.agent ? idByName.get(t.agent.toLowerCase()) : undefined;
      if (agentId) {
        store.noteThought(agentId, prov.model === '—' ? null : prov.model, prov.latencyMs);
      }
    }
    // Bound the dedupe set for long sessions.
    if (processedThoughtsRef.current.size > 200) {
      processedThoughtsRef.current = new Set(thoughts.map((t) => t.id));
    }
  }, [thoughts, agents]);

  // Concurrent live streams (matrix lanes or overlapping pipelines) — passive
  // cache read; TaskFeed's subscription keeps it hot.
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

  const streams = useMemo(() => {
    const nameById = new Map(agents.map((a) => [a.id, a.name]));
    return tasks
      .filter((t) => {
        const r = t.result as { streaming?: boolean } | null;
        return t.status === 'running' && Boolean(r?.streaming);
      })
      .slice(0, 3)
      .map((t) => {
        const r = (t.result ?? {}) as {
          preview?: string;
          chars?: number;
          matrix?: { role?: string };
        };
        return {
          taskId: t.id,
          agentName: (t.agent_id && nameById.get(t.agent_id)) || 'agent',
          role: r.matrix?.role ?? 'PIPELINE',
          preview: r.preview ?? '',
          chars: r.chars ?? 0,
        };
      });
  }, [tasks, agents]);

  const latest = thoughts.slice(0, 3);

  return (
    <div className="shrink-0 border-t border-border px-4 py-2">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5">
          <BrainCircuit className="size-3 text-neon-purple/80" />
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Agent Activity
          </span>
        </span>
        {thinking.map((b) => (
          <span key={b.label} className="flex items-center gap-1 font-terminal text-[10px]">
            <span
              className={cn(
                'size-1.5 rounded-full',
                b.active ? 'bg-neon-cyan animate-glow-pulse' : 'bg-muted-foreground/20',
              )}
            />
            <span className={b.active ? 'text-neon-cyan' : 'text-muted-foreground/50'}>
              {b.label}
              {b.active ? ' · thinking' : ''}
            </span>
          </span>
        ))}
      </div>

      {/* Parallel Execution Matrix: when ≥2 agents stream concurrently, the
          strip splits into a responsive grid — one live viewport per lane.
          Cells key by task id; each renders only its own rolling preview. */}
      {streams.length >= 2 && (
        <div
          className={cn(
            'mt-1.5 grid gap-1.5',
            streams.length === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-3',
          )}
        >
          {streams.map((s) => (
            <div
              key={s.taskId}
              className="min-w-0 rounded border border-neon-cyan/15 bg-neon-cyan/[0.03] px-2 py-1.5"
            >
              <div className="flex items-center gap-1.5 font-terminal text-[9px]">
                <span className="size-1 rounded-full bg-neon-cyan animate-glow-pulse" />
                <span className="text-neon-cyan/80">{s.agentName}</span>
                <span className="text-muted-foreground/40">{s.role}</span>
                <span className="ml-auto tabular text-muted-foreground/30">{s.chars} ch</span>
              </div>
              <p className="mt-0.5 max-h-10 overflow-hidden whitespace-pre-wrap break-words font-terminal text-[9px] leading-tight text-foreground/60">
                {s.preview}
                <span className="ml-0.5 inline-block h-2 w-1 translate-y-0.5 bg-neon-cyan/70 animate-glow-pulse" />
              </p>
            </div>
          ))}
        </div>
      )}

      {latest.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {latest.map((t) => {
            const prov = readProvenance(t);
            const badge = providerBadge(prov.provider);
            return (
              <div key={t.id} className="flex items-center gap-2 font-terminal text-[10px] leading-tight">
                <span className="shrink-0 text-foreground/70">{t.agent ?? '—'}</span>
                <span className={cn('shrink-0 rounded border px-1 py-px text-[8px] tracking-wider', badge.cls)}>
                  {badge.label}
                </span>
                <span className="shrink-0 text-muted-foreground/40">{prov.model}</span>
                {prov.latencyMs !== null && (
                  <span className="shrink-0 tabular text-muted-foreground/40">
                    {prov.latencyMs < 1000 ? `${prov.latencyMs}ms` : `${(prov.latencyMs / 1000).toFixed(1)}s`}
                  </span>
                )}
                <span className="min-w-0 truncate text-muted-foreground/60">{prov.preview}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

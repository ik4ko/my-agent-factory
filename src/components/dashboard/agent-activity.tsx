'use client';

import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BrainCircuit } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSupabaseRealtime } from '@/hooks/use-supabase-realtime';
import { AGENTS_KEY } from '@/hooks/use-agents-query';
import { cn } from '@/lib/utils';
import type { Agent, AgentType, SystemBusRow } from '@/lib/types/database.types';

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

/** Last N agent.thought events, kept live by realtime INSERTs. */
export function useBusThoughts(channelName: string): SystemBusRow[] {
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

  useSupabaseRealtime<SystemBusRow>({
    channel: channelName,
    table: 'system_bus',
    event: 'INSERT',
    onChange: ({ new: row }) => {
      if (!row || row.topic !== 'agent.thought') return;
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

  // Thinking state: a brain is "thinking" when any busy agent routes to it
  // (passive cache read — AgentFleet's subscription keeps this hot).
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

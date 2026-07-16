'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AGENTS_KEY } from '@/hooks/use-agents-query';
import { TASKS_KEY } from '@/hooks/use-tasks-query';
import { LOGS_KEY } from '@/hooks/use-logs-query';
import { METRICS_KEY, fetchMetrics24h } from '@/hooks/use-metrics-query';
import { createClient } from '@/lib/supabase/client';
import type { Agent, Log, Task } from '@/lib/types/database.types';

export type WorkspaceInitState = 'idle' | 'hydrating' | 'ready' | 'error';

interface Options {
  /** SSR payload — seeds the cache synchronously so first paint has no delay. */
  initial?: { agents?: Agent[]; tasks?: Task[]; logs?: Log[] };
}

/**
 * One-shot workspace hydrator for the control plane. Seeds every query key
 * from SSR data synchronously (zero layout shift), then runs parallel initial
 * fetches to reconcile anything stale after a tab close / process restart.
 * The realtime channels themselves are owned by each surface's query hook
 * (single-channel-per-table invariant) — this hook only guarantees the caches
 * are populated before/around subscription, so re-entry is instant.
 */
export function useWorkspaceInit({ initial }: Options = {}): {
  state: WorkspaceInitState;
  error: string | null;
} {
  const qc = useQueryClient();
  const [state, setState] = useState<WorkspaceInitState>('idle');
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    // Seed the caches POST-MOUNT, never during render. A render-phase
    // setQueryData synchronously notifies already-subscribed components
    // and trips React's "cannot update a
    // component while rendering a different component" on Fast Refresh
    // remounts. First paint loses nothing: every consumer hook already
    // receives this same SSR payload via its own useQuery `initialData`.
    if (initial) {
      if (initial.agents?.length) qc.setQueryData(AGENTS_KEY, initial.agents);
      if (initial.tasks?.length) qc.setQueryData(TASKS_KEY, initial.tasks);
      if (initial.logs?.length) qc.setQueryData(LOGS_KEY, initial.logs);
    }

    let cancelled = false;
    setState('hydrating');

    const supabase = createClient();
    const reconcile = Promise.allSettled([
      qc.ensureQueryData({
        queryKey: AGENTS_KEY,
        queryFn: async () => {
          const { data, error } = await supabase.from('agents').select('*').order('created_at', { ascending: true });
          if (error) throw error;
          return data as Agent[];
        },
      }),
      qc.ensureQueryData({
        queryKey: TASKS_KEY,
        queryFn: async () => {
          const { data, error } = await supabase
            .from('tasks').select('*').order('created_at', { ascending: false }).limit(20);
          if (error) throw error;
          return data as Task[];
        },
      }),
      qc.ensureQueryData({
        queryKey: LOGS_KEY,
        queryFn: async () => {
          const { data, error } = await supabase
            .from('logs').select('*').order('timestamp', { ascending: false }).limit(120);
          if (error) throw error;
          return ((data ?? []) as Log[]).reverse();
        },
      }),
      qc.ensureQueryData({ queryKey: METRICS_KEY, queryFn: fetchMetrics24h }),
    ]);

    reconcile.then((results) => {
      if (cancelled) return;
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length === results.length) {
        setError('workspace hydration failed');
        setState('error');
      } else {
        setState('ready');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [qc]);

  return { state, error };
}

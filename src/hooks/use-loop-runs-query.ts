'use client';

import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { subscribeWithReconnect } from '@/lib/supabase/realtime';
import { useConnectionStore } from '@/lib/realtime/connection-store';
import type { LoopRunRow } from '@/lib/types/database.types';

export const LOOP_RUNS_KEY = ['loop-runs'] as const;
const CHANNEL = 'loop-runs-changes';
const LIMIT = 30;

/** Most recent loop_runs across all loops (dashboard-wide activity feed). */
export function useLoopRunsQuery() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  useEffect(() => {
    const { setChannelStatus, clearChannel } = useConnectionStore.getState();

    const dispose = subscribeWithReconnect({
      client: supabase,
      name: CHANNEL,
      onStatusChange: (s) => setChannelStatus(CHANNEL, s),
      build: (channel) =>
        channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'loop_runs' },
          (payload) => {
            queryClient.setQueryData<LoopRunRow[]>(LOOP_RUNS_KEY, (prev = []) => {
              if (payload.eventType === 'INSERT') return [payload.new as LoopRunRow, ...prev].slice(0, LIMIT);
              if (payload.eventType === 'UPDATE')
                return prev.map((r) => (r.id === payload.new.id ? (payload.new as LoopRunRow) : r));
              return prev;
            });
          }
        ),
    });

    return () => {
      dispose();
      clearChannel(CHANNEL);
    };
  }, [queryClient, supabase]);

  return useQuery<LoopRunRow[]>({
    queryKey: LOOP_RUNS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('loop_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(LIMIT);
      if (error) throw error;
      return data;
    },
    staleTime: 10_000,
  });
}

'use client';

import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { subscribeWithReconnect } from '@/lib/supabase/realtime';
import { useConnectionStore } from '@/lib/realtime/connection-store';
import type { Metric } from '@/lib/types/database.types';

export const METRICS_KEY = ['metrics'] as const;
const LIMIT = 500; // 24h window, newest first
const CHANNEL = 'metrics-changes';

/**
 * Live 24h telemetry window. Owns the realtime subscription — mount from ONE
 * component (MetricsBar); everything else reads the shared cache passively
 * via useQuery({ queryKey: METRICS_KEY }).
 */
export function useMetricsQuery() {
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
          { event: 'INSERT', schema: 'public', table: 'metrics' },
          (payload) => {
            queryClient.setQueryData<Metric[]>(METRICS_KEY, (prev = []) =>
              [payload.new as Metric, ...prev].slice(0, LIMIT)
            );
          }
        ),
    });

    return () => {
      dispose();
      clearChannel(CHANNEL);
    };
  }, [queryClient, supabase]);

  return useQuery<Metric[]>({
    queryKey: METRICS_KEY,
    queryFn: fetchMetrics24h,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000, // periodic re-window (drops rows aging past 24h)
  });
}

export async function fetchMetrics24h(): Promise<Metric[]> {
  const supabase = createClient();
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const { data, error } = await supabase
    .from('metrics')
    .select('*')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(LIMIT);
  if (error) throw error;
  return (data ?? []) as Metric[];
}

'use client';

import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { subscribeWithReconnect } from '@/lib/supabase/realtime';
import { useConnectionStore } from '@/lib/realtime/connection-store';
import type { Agent } from '@/lib/types/database.types';

export const AGENTS_KEY = ['agents'] as const;
const CHANNEL = 'agents-changes';

export function useAgentsQuery(initialData: Agent[] = []) {
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
          { event: '*', schema: 'public', table: 'agents' },
          (payload) => {
            queryClient.setQueryData<Agent[]>(AGENTS_KEY, (prev = []) => {
              if (payload.eventType === 'INSERT') return [...prev, payload.new as Agent];
              if (payload.eventType === 'UPDATE')
                return prev.map((a) => (a.id === payload.new.id ? (payload.new as Agent) : a));
              if (payload.eventType === 'DELETE')
                return prev.filter((a) => a.id !== (payload.old as Agent).id);
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

  return useQuery<Agent[]>({
    queryKey: AGENTS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agents')
        .select('*')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },
    initialData: initialData.length > 0 ? initialData : undefined,
    staleTime: 30_000,
  });
}

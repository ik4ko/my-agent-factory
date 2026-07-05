'use client';

import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { subscribeWithReconnect } from '@/lib/supabase/realtime';
import { useConnectionStore } from '@/lib/realtime/connection-store';
import type { LoopRow } from '@/lib/types/database.types';

export const LOOPS_KEY = ['loops'] as const;
const CHANNEL = 'loops-changes';

export function useLoopsQuery() {
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
          { event: '*', schema: 'public', table: 'loops' },
          (payload) => {
            queryClient.setQueryData<LoopRow[]>(LOOPS_KEY, (prev = []) => {
              if (payload.eventType === 'INSERT') return [payload.new as LoopRow, ...prev];
              if (payload.eventType === 'UPDATE')
                return prev.map((l) => (l.id === payload.new.id ? (payload.new as LoopRow) : l));
              if (payload.eventType === 'DELETE') return prev.filter((l) => l.id !== (payload.old as LoopRow).id);
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

  return useQuery<LoopRow[]>({
    queryKey: LOOPS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.from('loops').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    staleTime: 15_000,
  });
}

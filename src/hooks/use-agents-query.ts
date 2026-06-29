'use client';

import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import type { Agent } from '@/lib/types/database.types';

export const AGENTS_KEY = ['agents'] as const;

export function useAgentsQuery(initialData: Agent[] = []) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel('agents-q')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agents' }, (payload) => {
        queryClient.setQueryData<Agent[]>(AGENTS_KEY, (prev = []) => {
          if (payload.eventType === 'INSERT') {
            return [...prev, payload.new as Agent];
          }
          if (payload.eventType === 'UPDATE') {
            return prev.map((a) => (a.id === payload.new.id ? (payload.new as Agent) : a));
          }
          if (payload.eventType === 'DELETE') {
            return prev.filter((a) => a.id !== (payload.old as Agent).id);
          }
          return prev;
        });
      })
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR') {
          console.error('[Realtime:agents-q] channel error', err);
        } else if (status === 'TIMED_OUT') {
          console.warn('[Realtime:agents-q] subscription timed out');
        }
      });

    return () => { supabase.removeChannel(channel); };
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

'use client';

import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { subscribeWithReconnect } from '@/lib/supabase/realtime';
import { useConnectionStore } from '@/lib/realtime/connection-store';
import type { Task } from '@/lib/types/database.types';

export const TASKS_KEY = ['tasks'] as const;
const LIMIT = 20;
const CHANNEL = 'tasks-changes';

export function useTasksQuery(initialData: Task[] = []) {
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
          { event: '*', schema: 'public', table: 'tasks' },
          (payload) => {
            queryClient.setQueryData<Task[]>(TASKS_KEY, (prev = []) => {
              if (payload.eventType === 'INSERT')
                return [payload.new as Task, ...prev].slice(0, LIMIT);
              if (payload.eventType === 'UPDATE')
                return prev.map((t) => (t.id === payload.new.id ? (payload.new as Task) : t));
              if (payload.eventType === 'DELETE')
                return prev.filter((t) => t.id !== (payload.old as Task).id);
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

  return useQuery<Task[]>({
    queryKey: TASKS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(LIMIT);
      if (error) throw error;
      return data;
    },
    initialData: initialData.length > 0 ? initialData : undefined,
    staleTime: 30_000,
  });
}

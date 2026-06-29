'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import type { Log } from '@/lib/types/database.types';

export const LOGS_KEY = ['logs'] as const;
const LIMIT = 120;

export function useLogsQuery(initialData: Log[] = []) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel('logs-q')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'logs' }, (payload) => {
        queryClient.setQueryData<Log[]>(LOGS_KEY, (prev = []) =>
          [...prev, payload.new as Log].slice(-LIMIT)
        );
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient, supabase]);

  return useQuery<Log[]>({
    queryKey: LOGS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(LIMIT);
      if (error) throw error;
      return (data ?? []).reverse();
    },
    initialData: initialData.length > 0 ? initialData : undefined,
    staleTime: 60_000,
  });
}

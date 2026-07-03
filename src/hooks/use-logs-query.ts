'use client';

import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { subscribeWithReconnect } from '@/lib/supabase/realtime';
import { useConnectionStore } from '@/lib/realtime/connection-store';
import type { Log } from '@/lib/types/database.types';

export const LOGS_KEY = ['logs'] as const;
const LIMIT = 120;
const CHANNEL = 'logs-stream';
const FLUSH_MS = 100;

export function useLogsQuery(initialData: Log[] = []) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  useEffect(() => {
    const { setChannelStatus, clearChannel } = useConnectionStore.getState();

    // Batch high-frequency INSERTs: agent thought-streams can emit dozens of
    // rows per second. Buffer them and flush on a short timer so the query
    // cache (and the subscribed list) re-renders at most ~10x/sec.
    let buffer: Log[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      flushTimer = null;
      if (buffer.length === 0) return;
      const incoming = buffer;
      buffer = [];
      queryClient.setQueryData<Log[]>(LOGS_KEY, (prev = []) =>
        [...prev, ...incoming].slice(-LIMIT)
      );
    };

    const dispose = subscribeWithReconnect({
      client: supabase,
      name: CHANNEL,
      onStatusChange: (s) => setChannelStatus(CHANNEL, s),
      build: (channel) =>
        channel.on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'logs' },
          (payload) => {
            buffer.push(payload.new as Log);
            if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
          }
        ),
    });

    return () => {
      if (flushTimer) clearTimeout(flushTimer);
      dispose();
      clearChannel(CHANNEL);
    };
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

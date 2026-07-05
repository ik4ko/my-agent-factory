'use client';

import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { subscribeWithReconnect } from '@/lib/supabase/realtime';
import { useConnectionStore } from '@/lib/realtime/connection-store';
import type { OrderRow } from '@/lib/types/database.types';

export const ORDERS_KEY = ['orders'] as const;
const CHANNEL = 'orders-changes';
const LIMIT = 50;

export function useOrdersQuery() {
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
          { event: '*', schema: 'public', table: 'orders' },
          (payload) => {
            queryClient.setQueryData<OrderRow[]>(ORDERS_KEY, (prev = []) => {
              if (payload.eventType === 'INSERT') return [payload.new as OrderRow, ...prev].slice(0, LIMIT);
              if (payload.eventType === 'UPDATE')
                return prev.map((o) => (o.id === payload.new.id ? (payload.new as OrderRow) : o));
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

  return useQuery<OrderRow[]>({
    queryKey: ORDERS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(LIMIT);
      if (error) throw error;
      return data;
    },
    staleTime: 10_000,
  });
}

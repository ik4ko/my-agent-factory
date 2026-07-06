'use client';

import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { subscribeWithReconnect } from '@/lib/supabase/realtime';
import { useConnectionStore } from '@/lib/realtime/connection-store';
import type { QuoteRow } from '@/lib/types/database.types';

export const QUOTES_KEY = ['quotes'] as const;
const CHANNEL = 'quotes-changes';

/** Live Finnhub-backed quote cache — the loop-worker upserts this every
 *  QUOTE_POLL_MS; Realtime streams the updates straight through. */
export function useQuotesQuery() {
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
          { event: '*', schema: 'public', table: 'quotes' },
          (payload) => {
            queryClient.setQueryData<QuoteRow[]>(QUOTES_KEY, (prev = []) => {
              const row = payload.new as QuoteRow;
              if (payload.eventType === 'DELETE') return prev.filter((q) => q.symbol !== (payload.old as QuoteRow).symbol);
              const exists = prev.some((q) => q.symbol === row.symbol);
              return exists ? prev.map((q) => (q.symbol === row.symbol ? row : q)) : [...prev, row].sort((a, b) => a.symbol.localeCompare(b.symbol));
            });
          }
        ),
    });

    return () => {
      dispose();
      clearChannel(CHANNEL);
    };
  }, [queryClient, supabase]);

  return useQuery<QuoteRow[]>({
    queryKey: QUOTES_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.from('quotes').select('*').order('symbol', { ascending: true });
      if (error) throw error;
      return data;
    },
    staleTime: 15_000,
  });
}

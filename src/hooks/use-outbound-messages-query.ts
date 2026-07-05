'use client';

import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { subscribeWithReconnect } from '@/lib/supabase/realtime';
import { useConnectionStore } from '@/lib/realtime/connection-store';

export interface OutboundMessageRow {
  id: string;
  channel: string;
  recipient: string;
  subject: string | null;
  body: string;
  agent: string | null;
  status: string;
  provider_id: string | null;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

export const OUTBOUND_MESSAGES_KEY = ['outbound-messages'] as const;
const CHANNEL = 'outbound-messages-changes';
const LIMIT = 40;

/** Every notification the system has sent, real-time — this IS the "SMS
 *  feed" today (LocalTransport), and will show real Twilio sends once
 *  configured, with zero code changes on this hook's side. */
export function useOutboundMessagesQuery() {
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
          { event: '*', schema: 'public', table: 'outbound_messages' },
          (payload) => {
            queryClient.setQueryData<OutboundMessageRow[]>(OUTBOUND_MESSAGES_KEY, (prev = []) => {
              if (payload.eventType === 'INSERT') return [payload.new as OutboundMessageRow, ...prev].slice(0, LIMIT);
              if (payload.eventType === 'UPDATE')
                return prev.map((m) => (m.id === payload.new.id ? (payload.new as OutboundMessageRow) : m));
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

  return useQuery<OutboundMessageRow[]>({
    queryKey: OUTBOUND_MESSAGES_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('outbound_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(LIMIT);
      if (error) throw error;
      return data as OutboundMessageRow[];
    },
    staleTime: 10_000,
  });
}

'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { subscribeWithReconnect } from '@/lib/supabase/realtime';
import { useConnectionStore } from '@/lib/realtime/connection-store';

/**
 * useSupabaseRealtime — thin declarative wrapper over the project's
 * reconnecting channel primitive (subscribeWithReconnect), so observer
 * components subscribe with one hook instead of hand-rolled effects.
 *
 * `channel` must be unique per mounted subscription. The handler flows
 * through a ref, so a new closure never tears the socket down.
 */

export interface RealtimeChange<Row extends Record<string, unknown>> {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Row | null;
  old: Partial<Row> | null;
}

interface UseSupabaseRealtimeOptions<Row extends Record<string, unknown>> {
  channel: string;
  table: string;
  event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
  onChange: (change: RealtimeChange<Row>) => void;
}

export function useSupabaseRealtime<Row extends Record<string, unknown>>({
  channel,
  table,
  event = '*',
  onChange,
}: UseSupabaseRealtimeOptions<Row>): void {
  const handlerRef = useRef(onChange);
  handlerRef.current = onChange;

  useEffect(() => {
    const supabase = createClient();
    const { setChannelStatus, clearChannel } = useConnectionStore.getState();

    const dispose = subscribeWithReconnect({
      client: supabase,
      name: channel,
      onStatusChange: (s) => setChannelStatus(channel, s),
      build: (ch) =>
        ch.on(
          'postgres_changes',
          // supabase-js's overloads want a literal event type; the union is
          // safe at runtime — narrow through the specific-event signature.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { event: event as any, schema: 'public', table },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload: any) =>
            handlerRef.current({
              eventType: payload.eventType,
              new: (payload.new ?? null) as Row | null,
              old: (payload.old ?? null) as Partial<Row> | null,
            }),
        ),
    });

    return () => {
      dispose();
      clearChannel(channel);
    };
  }, [channel, table, event]);
}

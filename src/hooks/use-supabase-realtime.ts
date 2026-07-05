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
 * HARDENING GUARANTEES (a telemetry hook must never take down the shell):
 *  - No-throw: client construction, subscription build, handler dispatch,
 *    and teardown are ALL fenced — any failure degrades to a console.warn
 *    and the hook becomes a no-op for that mount.
 *  - SSR/hydration-safe: everything effectful lives inside useEffect (never
 *    runs on the server) plus an explicit `typeof window` guard, and the
 *    hook bails silently when `channel`/`table` are empty or the Supabase
 *    client is unavailable (missing env), instead of throwing.
 *  - StrictMode-safe: cleanup unsubscribes the channel, removes it from the
 *    client, and nullifies the disposer ref, so the double mount/unmount
 *    cycle cannot leak sockets or fire handlers on a dead mount.
 *  - The handler flows through a ref, so new closures never resubscribe.
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
  /** Server-side row filter (PostgREST syntax, e.g. 'topic=eq.agent.thought').
   *  Filtering at the CHANNEL level keeps non-matching rows — and their
   *  payloads — off the wire entirely. */
  filter?: string;
  onChange: (change: RealtimeChange<Row>) => void;
}

export function useSupabaseRealtime<Row extends Record<string, unknown>>({
  channel,
  table,
  event = '*',
  filter,
  onChange,
}: UseSupabaseRealtimeOptions<Row>): void {
  const handlerRef = useRef(onChange);
  handlerRef.current = onChange;
  const disposeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Early safety exits — misconfiguration must degrade, not throw.
    if (typeof window === 'undefined') return;
    if (!channel || !table) {
      console.warn('[useSupabaseRealtime] missing channel/table — subscription skipped');
      return;
    }

    let supabase: ReturnType<typeof createClient>;
    try {
      // createClient throws in the browser when NEXT_PUBLIC_* env is absent
      // or malformed; an observer hook swallows that into a warning.
      supabase = createClient();
    } catch (err) {
      console.warn(`[useSupabaseRealtime:${channel}] Supabase client unavailable — subscription skipped:`, err);
      return;
    }

    const { setChannelStatus, clearChannel } = useConnectionStore.getState();
    let mounted = true;

    try {
      disposeRef.current = subscribeWithReconnect({
        client: supabase,
        name: channel,
        onStatusChange: (s) => setChannelStatus(channel, s),
        build: (ch) =>
          ch.on(
            'postgres_changes',
            // supabase-js's overloads want a literal event type; the union
            // is safe at runtime — narrow through the specific signature.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { event: event as any, schema: 'public', table, ...(filter ? { filter } : {}) },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (payload: any) => {
              if (!mounted) return; // StrictMode: never fire on a dead mount
              try {
                handlerRef.current({
                  eventType: payload.eventType,
                  new: (payload.new ?? null) as Row | null,
                  old: (payload.old ?? null) as Partial<Row> | null,
                });
              } catch (err) {
                console.warn(`[useSupabaseRealtime:${channel}] handler error:`, err);
              }
            },
          ),
      });
    } catch (err) {
      console.warn(`[useSupabaseRealtime:${channel}] subscription failed:`, err);
      disposeRef.current = null;
      return;
    }

    return () => {
      mounted = false;
      try {
        // The disposer unsubscribes AND removes the channel from the client
        // (client.removeChannel → channel.unsubscribe under the hood).
        disposeRef.current?.();
      } catch (err) {
        console.warn(`[useSupabaseRealtime:${channel}] teardown error:`, err);
      } finally {
        disposeRef.current = null; // nullify for StrictMode remounts
        clearChannel(channel);
      }
    };
  }, [channel, table, event, filter]);
}

'use client';

import type { RealtimeChannel } from '@supabase/supabase-js';
import type { createClient } from '@/lib/supabase/client';
import type { ChannelStatus } from '@/lib/realtime/connection-store';

type SupabaseBrowserClient = ReturnType<typeof createClient>;

interface ReconnectOptions {
  client: SupabaseBrowserClient;
  /** Unique channel name. */
  name: string;
  /** Attach `.on(...)` handlers to the raw channel and return it. */
  build: (channel: RealtimeChannel) => RealtimeChannel;
  /** Reports lifecycle transitions for UI/status consumers. */
  onStatusChange?: (status: ChannelStatus) => void;
  /** Max backoff between reconnect attempts (ms). */
  maxDelayMs?: number;
}

/**
 * Subscribes to a Supabase Realtime channel with automatic, exponentially
 * backed-off reconnection. Returns a disposer that tears the channel down
 * cleanly (no reconnect storms on unmount). The Supabase socket already
 * auto-reconnects at the transport layer; this adds channel-level recovery
 * for CHANNEL_ERROR / TIMED_OUT / unexpected CLOSED.
 */
export function subscribeWithReconnect({
  client,
  name,
  build,
  onStatusChange,
  maxDelayMs = 15_000,
}: ReconnectOptions): () => void {
  let channel: RealtimeChannel | null = null;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const report = (s: ChannelStatus) => onStatusChange?.(s);

  const scheduleReconnect = () => {
    if (disposed || reconnectTimer) return;
    const delay = Math.min(1_000 * 2 ** attempt, maxDelayMs);
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (disposed) return;
      if (channel) {
        client.removeChannel(channel);
        channel = null;
      }
      connect();
    }, delay);
  };

  const connect = () => {
    if (disposed) return;
    report(attempt === 0 ? 'connecting' : 'reconnecting');
    channel = build(client.channel(name)).subscribe((status, err) => {
      if (disposed) return;
      if (status === 'SUBSCRIBED') {
        attempt = 0;
        report('connected');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (err) console.error(`[Realtime:${name}] ${status}`, err);
        else console.warn(`[Realtime:${name}] ${status} — scheduling reconnect`);
        report('reconnecting');
        scheduleReconnect();
      }
    });
  };

  connect();

  return () => {
    disposed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (channel) client.removeChannel(channel);
    report('closed');
  };
}

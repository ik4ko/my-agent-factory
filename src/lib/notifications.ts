'use client';

import { createBrowserClient } from '@supabase/ssr';

export interface NotificationDoc {
  id: string;
  agency_id: string;
  ghl_contact_id: string;
  event_type: string;
  risk_level: string;
  trigger_reason: string | null;
  source: string | null;
  created_at: string;
}

export interface FCMNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

// Push token registration is handled server-side.
export async function registerForPushNotifications(
  _userId: string,
): Promise<string | null> {
  console.log('[notifications] Push registration stubbed — implement via Supabase Edge Function');
  return null;
}

// Foreground message listener stub.
export async function onForegroundNotification(
  _callback: (payload: FCMNotificationPayload) => void,
): Promise<() => void> {
  return () => {};
}

/**
 * Subscribes to retention_events for in-app notification stream.
 * Returns an unsubscribe function.
 */
export function subscribeToNotifications(
  agencyId: string,
  callback: (notifications: NotificationDoc[]) => void,
  maxItems = 50,
): () => void {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const fetchLatest = () =>
    supabase
      .from('retention_events')
      .select('*')
      .eq('agency_id', agencyId)
      .order('created_at', { ascending: false })
      .limit(maxItems)
      .then(({ data }) => {
        if (data) callback(data as NotificationDoc[]);
      });

  fetchLatest();

  const channel = supabase
    .channel(`notifications:${agencyId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'retention_events',
        filter: `agency_id=eq.${agencyId}`,
      },
      () => fetchLatest(),
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

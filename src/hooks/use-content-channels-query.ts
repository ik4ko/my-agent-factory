'use client';

import { useQueryClient, useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useSupabaseRealtime } from '@/hooks/use-supabase-realtime';
import type { ContentChannel } from '@/lib/types/database.types';

/** Shared query key for the content-channel switcher. */
export const CONTENT_CHANNELS_KEY = ['content-channels'] as const;

/**
 * Active content channels, live.
 *
 * Subscribes to the content_channels table so a channel added through the
 * room's "+ Add channel" form appears immediately in every open tab — the
 * same realtime posture as every other list in this dashboard, which is what
 * makes "channels are data" feel real rather than requiring a refresh.
 */
export function useContentChannels(initial: ContentChannel[] = []) {
  const queryClient = useQueryClient();

  useSupabaseRealtime<Record<string, unknown>>({
    channel: 'content-channels-feed',
    table: 'content_channels',
    onChange: () => {
      void queryClient.invalidateQueries({ queryKey: CONTENT_CHANNELS_KEY });
    },
  });

  return useQuery<ContentChannel[]>({
    queryKey: CONTENT_CHANNELS_KEY,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from('content_channels')
        .select('*')
        .eq('active', true)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as ContentChannel[];
    },
    initialData: initial.length ? initial : undefined,
    staleTime: 30_000,
  });
}

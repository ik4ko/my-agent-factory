'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSupabaseRealtime } from '@/hooks/use-supabase-realtime';
import type {
  ContentChannelLink,
  ContentChannelStatsSnapshot,
  ContentChannelVideo,
} from '@/lib/types/database.types';

export interface ChannelLinkBundle {
  link: ContentChannelLink;
  latest: ContentChannelStatsSnapshot | null;
  delta: { subscribers: number | null; views: number | null; since: string } | null;
  videos: ContentChannelVideo[];
}

export const CHANNEL_LINKS_KEY = ['content-channel-links'] as const;
export const channelLinkKey = (linkId: string) => ['content-channel-link', linkId] as const;

/** Links for one channel. Realtime so a connect/disconnect in another tab
 *  lands here without a refresh, matching every other list in the dashboard. */
export function useChannelLinks(channelId: string | null) {
  const queryClient = useQueryClient();

  useSupabaseRealtime<Record<string, unknown>>({
    channel: 'content-channel-links-feed',
    table: 'content_channel_links',
    onChange: () => {
      void queryClient.invalidateQueries({ queryKey: CHANNEL_LINKS_KEY });
    },
  });

  return useQuery<ContentChannelLink[]>({
    queryKey: [...CHANNEL_LINKS_KEY, channelId],
    enabled: Boolean(channelId),
    queryFn: async () => {
      const res = await fetch(`/api/content/links?channelId=${channelId}`);
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load links');
      return (await res.json()).links as ContentChannelLink[];
    },
    staleTime: 30_000,
  });
}

/** Stats + videos for one link. Subscribes to the snapshot table so a refresh
 *  (which INSERTs a snapshot) repaints the panel live. */
export function useChannelLinkBundle(linkId: string | null) {
  const queryClient = useQueryClient();

  useSupabaseRealtime<Record<string, unknown>>({
    channel: linkId ? `content-link-stats-${linkId}` : '',
    table: 'content_channel_stats_snapshots',
    filter: linkId ? `link_id=eq.${linkId}` : undefined,
    onChange: () => {
      if (linkId) void queryClient.invalidateQueries({ queryKey: channelLinkKey(linkId) });
    },
  });

  return useQuery<ChannelLinkBundle>({
    queryKey: linkId ? channelLinkKey(linkId) : ['content-channel-link', 'none'],
    enabled: Boolean(linkId),
    queryFn: async () => {
      const res = await fetch(`/api/content/links/${linkId}`);
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load channel stats');
      return (await res.json()) as ChannelLinkBundle;
    },
    staleTime: 15_000,
  });
}

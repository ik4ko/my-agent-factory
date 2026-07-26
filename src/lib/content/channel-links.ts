import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import {
  YoutubeDataError,
  fetchVideoStats,
  listUploadVideoIds,
  newLedger,
  resolveChannel,
  type CallLedger,
  type ResolvedChannel,
} from './youtube-data';
import type {
  ContentChannelLink,
  ContentChannelStatsSnapshot,
  ContentChannelVideo,
} from '@/lib/types/database.types';

/**
 * Persistence + sync orchestration for channel links.
 *
 * ONE server-side fetcher — the room never calls the YouTube API per UI
 * action. Every refresh goes through `refreshLink`, which is the single place
 * quota is spent and the single place a failure is recorded.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

/** Videos pulled per refresh. 20 keeps a refresh at 3 units (see refreshLink). */
export const DEFAULT_VIDEO_LIMIT = 20;

export async function listLinks(channelId?: string): Promise<ContentChannelLink[]> {
  let q = db().from('content_channel_links').select('*').order('connected_at', { ascending: true });
  if (channelId) q = q.eq('channel_id', channelId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as ContentChannelLink[];
}

export async function getLink(linkId: string): Promise<ContentChannelLink | null> {
  const { data } = await db().from('content_channel_links').select('*').eq('id', linkId).maybeSingle();
  return (data as ContentChannelLink) ?? null;
}

/** Newest-first snapshots. Two are enough for the delta readout; the same
 *  query shape serves a future growth chart with a larger limit. */
export async function listSnapshots(linkId: string, limit = 2): Promise<ContentChannelStatsSnapshot[]> {
  const { data, error } = await db()
    .from('content_channel_stats_snapshots')
    .select('*')
    .eq('link_id', linkId)
    .order('fetched_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ContentChannelStatsSnapshot[];
}

export async function listVideos(linkId: string, limit = DEFAULT_VIDEO_LIMIT): Promise<ContentChannelVideo[]> {
  const { data, error } = await db()
    .from('content_channel_videos')
    .select('*')
    .eq('link_id', linkId)
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ContentChannelVideo[];
}

/** Creates (or re-points) the link for a channel+platform. external_id comes
 *  from an already-confirmed resolution, so no quota is spent here. */
export async function saveLink(input: {
  channelId: string;
  platform?: string;
  handle: string | null;
  externalId: string;
}): Promise<ContentChannelLink> {
  const { data, error } = await db()
    .from('content_channel_links')
    .upsert(
      {
        channel_id: input.channelId,
        platform: input.platform ?? 'youtube',
        handle: input.handle,
        external_id: input.externalId,
        last_error: null,
      },
      { onConflict: 'channel_id,platform' },
    )
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as ContentChannelLink;
}

export async function deleteLink(linkId: string): Promise<void> {
  // Snapshots and videos cascade — disconnecting is a full forget.
  const { error } = await db().from('content_channel_links').delete().eq('id', linkId);
  if (error) throw new Error(error.message);
}

async function recordLinkError(linkId: string, message: string): Promise<void> {
  await db()
    .from('content_channel_links')
    .update({ last_error: message.slice(0, 400) })
    .eq('id', linkId);
}

export interface RefreshResult {
  ok: boolean;
  error?: string;
  /** Quota actually consumed, so the room can show the real cost per refresh. */
  quota: { units: number; searchCalls: number; calls: string[] };
  channel?: ResolvedChannel;
  videoCount?: number;
}

/**
 * The ONE refresh path. Quota cost for a channel with N videos:
 *
 *   channels.list       1 unit                (stats + uploads playlist id)
 *   playlistItems.list  ceil(N/50) units      (1 for the default 20)
 *   videos.list         ceil(N/50) units      (1 for the default 20 — batched)
 *   ---------------------------------------------------------------
 *   3 units for a 20-video refresh. Comments are NOT fetched here.
 *
 * Never throws on an API failure: the error is written to link.last_error and
 * returned, so the room shows "refresh failed: quota exceeded" beside a stale
 * last_synced_at instead of crashing or silently doing nothing.
 */
export async function refreshLink(linkId: string, videoLimit = DEFAULT_VIDEO_LIMIT): Promise<RefreshResult> {
  const ledger: CallLedger = newLedger();
  const link = await getLink(linkId);
  if (!link) return { ok: false, error: 'Link not found', quota: ledger };

  try {
    // Always resolve by cached external_id — never re-pay a handle/custom-URL
    // lookup on refresh.
    const channel = await resolveChannel({ kind: 'id', value: link.external_id }, ledger);

    await db().from('content_channel_stats_snapshots').insert({
      link_id: linkId,
      subscriber_count: channel.subscriberCount,
      view_count: channel.viewCount,
      video_count: channel.videoCount,
      raw: channel.raw ?? {},
    });

    let videoCount = 0;
    if (channel.uploadsPlaylistId) {
      const ids = await listUploadVideoIds(channel.uploadsPlaylistId, ledger, videoLimit);
      if (ids.length > 0) {
        const stats = await fetchVideoStats(ids, ledger);
        videoCount = stats.length;
        const now = new Date().toISOString();
        await db()
          .from('content_channel_videos')
          .upsert(
            stats.map((v) => ({
              link_id: linkId,
              external_video_id: v.externalVideoId,
              title: v.title,
              thumbnail_url: v.thumbnailUrl,
              published_at: v.publishedAt,
              view_count: v.viewCount,
              like_count: v.likeCount,
              comment_count: v.commentCount,
              last_synced_at: now,
            })),
            { onConflict: 'link_id,external_video_id' },
          );
      }
    }

    await db()
      .from('content_channel_links')
      .update({ last_synced_at: new Date().toISOString(), last_error: null })
      .eq('id', linkId);

    await hermesLog(
      'success',
      `[CONTENT] synced ${channel.title} — ${videoCount} videos, ${ledger.units} quota units`,
    );
    return { ok: true, quota: ledger, channel, videoCount };
  } catch (err) {
    const message =
      err instanceof YoutubeDataError ? err.message : `Sync failed: ${String(err).slice(0, 200)}`;
    await recordLinkError(linkId, message);
    await hermesLog('warn', `[CONTENT] sync failed for link ${linkId.slice(0, 8)} — ${message}`);
    return { ok: false, error: message, quota: ledger };
  }
}

/** Subscriber/view delta between the two newest snapshots. Null until a second
 *  snapshot exists, so a freshly-connected channel degrades to no-trend-yet
 *  rather than showing a fake +0. */
export function snapshotDelta(snapshots: ContentChannelStatsSnapshot[]): {
  subscribers: number | null;
  views: number | null;
  since: string;
} | null {
  if (snapshots.length < 2) return null;
  const [newest, previous] = snapshots;
  const diff = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);
  return {
    subscribers: diff(newest.subscriber_count, previous.subscriber_count),
    views: diff(newest.view_count, previous.view_count),
    since: previous.fetched_at,
  };
}

/**
 * YouTube Data API v3 — read-only channel/video fetcher.
 *
 * SEPARATE CONCERN from the content-generation pipeline. This module is a
 * sibling of integrations.ts and deliberately does not touch it or
 * playbook.ts: reading public stats needs a plain API key
 * (YOUTUBE_DATA_API_KEY), NOT the OAuth refresh token the publish stage will
 * eventually need. Read-only, free, no consent screen — much lower friction.
 *
 * ── QUOTA MODEL (verified against the live docs 2026-07-26) ────────────────
 * The default allocation is 10,000 units/day for all endpoints EXCEPT
 * search.list and videos.insert, which now sit in their own buckets capped at
 * 100 calls/day each. Per the reference pages:
 *   channels.list        1 unit
 *   playlistItems.list   1 unit   (maxResults max 50)
 *   videos.list          1 unit   (batched ids — 1 unit TOTAL, not per video)
 *   commentThreads.list  1 unit
 *   search.list          1 unit, but from the 100-calls/day Search bucket
 *
 * NOTE: search.list is no longer the 100-unit call it used to be. It is still
 * avoided for listing videos, because 100 calls/day is a far scarcer budget
 * than 10,000 units — and the uploads-playlist path below never touches that
 * bucket at all.
 *
 * The listing strategy is therefore:
 *   channels.list (1)  -> contentDetails.relatedPlaylists.uploads
 *   playlistItems.list (1/page, 50 ids per page)
 *   videos.list (1 per batch of 50 ids)
 * Comments are NEVER fetched in a refresh — only lazily, per video, on click.
 */

const API_ROOT = 'https://www.googleapis.com/youtube/v3';

/** Max ids per videos.list call. The reference page does not state a limit;
 *  50 is the documented ceiling for maxResults across the list endpoints and
 *  the batch size the API is designed around. Kept explicit so the batching
 *  test has something to pin. */
export const VIDEOS_LIST_BATCH_SIZE = 50;
/** Hard page ceiling for playlistItems pagination — a malformed or repeating
 *  nextPageToken must never spin forever. 20 pages = 1000 videos. */
export const MAX_UPLOAD_PAGES = 20;

// ── Gating (same declared/gated shape as CONTENT_INTEGRATIONS) ──────────────

export interface YoutubeDataReadiness {
  service: string;
  envVars: string[];
  configured: boolean;
  missing: string[];
  note: string;
}

export function isYoutubeDataConfigured(): boolean {
  return Boolean(process.env.YOUTUBE_DATA_API_KEY?.trim());
}

export function youtubeDataStatus(): YoutubeDataReadiness {
  const configured = isYoutubeDataConfigured();
  return {
    service: 'YouTube Data API v3 (read-only)',
    envVars: ['YOUTUBE_DATA_API_KEY'],
    configured,
    missing: configured ? [] : ['YOUTUBE_DATA_API_KEY'],
    note: 'Read-only API key — free, no OAuth consent screen. Distinct from the OAuth token publishing will need.',
  };
}

// ── Errors ─────────────────────────────────────────────────────────────────

export type YoutubeErrorKind = 'not-configured' | 'quota-exceeded' | 'not-found' | 'api-error' | 'bad-input';

export class YoutubeDataError extends Error {
  constructor(readonly kind: YoutubeErrorKind, message: string) {
    super(message);
    this.name = 'YoutubeDataError';
  }
}

/** Maps a Google error payload to a kind. quotaExceeded / dailyLimitExceeded
 *  arrive as 403 and must degrade to a surfaced message, never a crash. */
export function classifyYoutubeFailure(status: number, body: string): YoutubeDataError {
  const lowered = body.toLowerCase();
  if (status === 403 && (lowered.includes('quotaexceeded') || lowered.includes('dailylimitexceeded'))) {
    return new YoutubeDataError('quota-exceeded', 'YouTube API daily quota exceeded — try again after the quota resets (midnight Pacific).');
  }
  if (status === 403) return new YoutubeDataError('api-error', `YouTube API refused the request (403). Check the key's API restrictions.`);
  if (status === 404) return new YoutubeDataError('not-found', 'Channel or video not found.');
  return new YoutubeDataError('api-error', `YouTube API error ${status}: ${body.slice(0, 160)}`);
}

/** Every call funnels through here so quota accounting and error mapping are
 *  in exactly one place. `units` is charged to the main bucket unless the
 *  endpoint is search.list. */
interface CallLedger {
  units: number;
  searchCalls: number;
  calls: string[];
}

async function apiGet<T>(
  endpoint: string,
  params: Record<string, string | number | undefined>,
  ledger: CallLedger,
): Promise<T> {
  const key = process.env.YOUTUBE_DATA_API_KEY?.trim();
  if (!key) throw new YoutubeDataError('not-configured', 'YOUTUBE_DATA_API_KEY is not configured.');

  const qs = new URLSearchParams({ key });
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') qs.set(k, String(v));
  }

  const res = await fetch(`${API_ROOT}/${endpoint}?${qs}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });

  // Charge quota for the ATTEMPT — a failed call still consumes it.
  if (endpoint === 'search') ledger.searchCalls += 1;
  else ledger.units += 1;
  ledger.calls.push(endpoint);

  if (!res.ok) throw classifyYoutubeFailure(res.status, await res.text().catch(() => ''));
  return (await res.json()) as T;
}

export function newLedger(): CallLedger {
  return { units: 0, searchCalls: 0, calls: [] };
}
export type { CallLedger };

// ── URL / handle parsing ───────────────────────────────────────────────────

export type ChannelInputKind = 'id' | 'handle' | 'username' | 'custom';

export interface ParsedChannelInput {
  kind: ChannelInputKind;
  value: string;
}

/**
 * Accepts the four formats operators actually paste, plus a bare handle.
 *
 *   /channel/UC…   -> id       (channels.list?id=,          1 unit)
 *   /@handle       -> handle   (channels.list?forHandle=,   1 unit)
 *   /user/Name     -> username (channels.list?forUsername=, 1 unit)
 *   /c/CustomName  -> custom   (NO cheap official lookup — see resolveChannel)
 *
 * Returns null for input that is not recognizably a YouTube channel reference,
 * so the connect UI can reject it before spending any quota.
 */
export function parseChannelInput(raw: string): ParsedChannelInput | null {
  const input = raw.trim();
  if (!input) return null;

  // Bare handle or bare channel id, no URL wrapper.
  if (/^@[\w.-]{3,}$/.test(input)) return { kind: 'handle', value: input.slice(1) };
  if (/^UC[\w-]{20,}$/.test(input)) return { kind: 'id', value: input };

  let path: string;
  try {
    const url = new URL(input.startsWith('http') ? input : `https://${input}`);
    if (!/(^|\.)youtube\.com$/.test(url.hostname) && url.hostname !== 'youtu.be') return null;
    path = url.pathname;
  } catch {
    return null;
  }

  const seg = path.split('/').filter(Boolean);
  if (seg.length === 0) return null;

  if (seg[0] === 'channel' && seg[1]) return { kind: 'id', value: seg[1] };
  if (seg[0] === 'user' && seg[1]) return { kind: 'username', value: seg[1] };
  if (seg[0] === 'c' && seg[1]) return { kind: 'custom', value: seg[1] };
  if (seg[0].startsWith('@') && seg[0].length > 1) return { kind: 'handle', value: seg[0].slice(1) };
  return null;
}

// ── Channel resolution ─────────────────────────────────────────────────────

export interface ResolvedChannel {
  externalId: string;
  title: string;
  handle: string | null;
  description: string;
  thumbnailUrl: string | null;
  subscriberCount: number | null;
  viewCount: number | null;
  videoCount: number | null;
  uploadsPlaylistId: string | null;
  /** Raw channels.list item, stored on the snapshot so a future metric needs
   *  no backfill. */
  raw: unknown;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapChannelItem(item: any): ResolvedChannel {
  const sn = item?.snippet ?? {};
  const st = item?.statistics ?? {};
  const num = (v: unknown) => (v === undefined || v === null ? null : Number(v));
  return {
    externalId: String(item?.id ?? ''),
    title: String(sn.title ?? ''),
    handle: sn.customUrl ? String(sn.customUrl).replace(/^@/, '') : null,
    description: String(sn.description ?? ''),
    thumbnailUrl: sn.thumbnails?.high?.url ?? sn.thumbnails?.default?.url ?? null,
    subscriberCount: st.hiddenSubscriberCount ? null : num(st.subscriberCount),
    viewCount: num(st.viewCount),
    videoCount: num(st.videoCount),
    uploadsPlaylistId: item?.contentDetails?.relatedPlaylists?.uploads ?? null,
    raw: item,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const CHANNEL_PARTS = 'snippet,statistics,contentDetails';

/**
 * Resolves any accepted input to a real channel. One channels.list call
 * (1 unit) for id/handle/username.
 *
 * The /c/ custom-URL case has no cheap official lookup. We resolve it with a
 * single search.list — now 1 unit from the 100-calls/day Search bucket rather
 * than the old 100-unit charge — and the caller caches external_id forever, so
 * this is paid once per channel, never per refresh. Search returns a best
 * match rather than an exact one, which is precisely why the connect flow
 * confirms the resolved name + avatar before saving.
 */
export async function resolveChannel(
  parsed: ParsedChannelInput,
  ledger: CallLedger,
): Promise<ResolvedChannel> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byFilter = async (filter: Record<string, string>): Promise<any> => {
    const data = await apiGet<{ items?: unknown[] }>('channels', { part: CHANNEL_PARTS, ...filter }, ledger);
    return data.items?.[0];
  };

  let item: unknown;
  if (parsed.kind === 'id') item = await byFilter({ id: parsed.value });
  else if (parsed.kind === 'handle') item = await byFilter({ forHandle: parsed.value });
  else if (parsed.kind === 'username') item = await byFilter({ forUsername: parsed.value });
  else {
    // custom (/c/Name) — one Search-bucket call, then a normal channels.list
    // on the id so we get identical fields to every other path.
    const found = await apiGet<{ items?: Array<{ id?: { channelId?: string } }> }>(
      'search',
      { part: 'snippet', type: 'channel', q: parsed.value, maxResults: 1 },
      ledger,
    );
    const channelId = found.items?.[0]?.id?.channelId;
    if (!channelId) throw new YoutubeDataError('not-found', `No channel matched "/c/${parsed.value}".`);
    item = await byFilter({ id: channelId });
  }

  if (!item) throw new YoutubeDataError('not-found', `No channel matched that ${parsed.kind}.`);
  return mapChannelItem(item);
}

// ── Video listing ──────────────────────────────────────────────────────────

export interface VideoStat {
  externalVideoId: string;
  title: string;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
}

/**
 * Video ids from the uploads playlist. 1 unit per page of up to 50.
 *
 * Pagination terminates on ANY of: no token, a repeated token (the API
 * looping), a non-string token, an empty page, or MAX_UPLOAD_PAGES — a
 * malformed nextPageToken must not spin forever.
 */
export async function listUploadVideoIds(
  uploadsPlaylistId: string,
  ledger: CallLedger,
  limit = 20,
): Promise<string[]> {
  const ids: string[] = [];
  const seenTokens = new Set<string>();
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_UPLOAD_PAGES && ids.length < limit; page++) {
    const data = await apiGet<{
      items?: Array<{ contentDetails?: { videoId?: string } }>;
      nextPageToken?: unknown;
    }>(
      'playlistItems',
      {
        part: 'contentDetails',
        playlistId: uploadsPlaylistId,
        maxResults: Math.min(50, limit - ids.length),
        pageToken,
      },
      ledger,
    );

    const pageIds = (data.items ?? [])
      .map((i) => i.contentDetails?.videoId)
      .filter((v): v is string => typeof v === 'string' && v.length > 0);
    if (pageIds.length === 0) break; // empty page — nothing more to walk
    ids.push(...pageIds);

    const next = data.nextPageToken;
    if (typeof next !== 'string' || next.length === 0) break; // absent/malformed
    if (seenTokens.has(next)) break; // API returned a cycle
    seenTokens.add(next);
    pageToken = next;
  }

  return ids.slice(0, limit);
}

/** Splits ids into API-sized batches. Exported so the batching test can assert
 *  the shape directly rather than inferring it from call counts. */
export function batchVideoIds(ids: string[], size = VIDEOS_LIST_BATCH_SIZE): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += size) batches.push(ids.slice(i, i + size));
  return batches;
}

/**
 * Stats for the given video ids. ONE videos.list call per batch of 50 — 1 unit
 * per batch, NOT per video. 20 videos is a single unit.
 */
export async function fetchVideoStats(ids: string[], ledger: CallLedger): Promise<VideoStat[]> {
  const out: VideoStat[] = [];
  for (const batch of batchVideoIds(ids)) {
    const data = await apiGet<{ items?: unknown[] }>(
      'videos',
      { part: 'snippet,statistics', id: batch.join(',') },
      ledger,
    );
    for (const raw of data.items ?? []) {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const item = raw as any;
      const sn = item?.snippet ?? {};
      const st = item?.statistics ?? {};
      const num = (v: unknown) => (v === undefined || v === null ? null : Number(v));
      out.push({
        externalVideoId: String(item?.id ?? ''),
        title: String(sn.title ?? ''),
        thumbnailUrl: sn.thumbnails?.medium?.url ?? sn.thumbnails?.default?.url ?? null,
        publishedAt: sn.publishedAt ?? null,
        viewCount: num(st.viewCount),
        likeCount: num(st.likeCount),
        commentCount: num(st.commentCount),
      });
      /* eslint-enable @typescript-eslint/no-explicit-any */
    }
  }
  return out;
}

// ── Comments (lazy, click-through only) ────────────────────────────────────

export interface VideoComment {
  id: string;
  author: string;
  authorAvatarUrl: string | null;
  text: string;
  likeCount: number;
  publishedAt: string | null;
}

/**
 * Top-level comments for ONE video. 1 unit.
 *
 * Deliberately never called during a refresh: at one call per video, three
 * channels x 20 videos would be 60 units per sync purely for comments nobody
 * asked to read. Invoked only when the operator clicks into a video.
 */
export async function fetchVideoComments(
  videoId: string,
  ledger: CallLedger,
  maxResults = 20,
): Promise<VideoComment[]> {
  const data = await apiGet<{ items?: unknown[] }>(
    'commentThreads',
    { part: 'snippet', videoId, maxResults: Math.min(100, maxResults), order: 'relevance' },
    ledger,
  );
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data.items ?? []).map((raw) => {
    const top = (raw as any)?.snippet?.topLevelComment?.snippet ?? {};
    return {
      id: String((raw as any)?.id ?? ''),
      author: String(top.authorDisplayName ?? ''),
      authorAvatarUrl: top.authorProfileImageUrl ?? null,
      text: String(top.textDisplay ?? ''),
      likeCount: Number(top.likeCount ?? 0),
      publishedAt: top.publishedAt ?? null,
    };
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

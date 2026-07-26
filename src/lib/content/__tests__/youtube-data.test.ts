// Quota-safety and resolution tests for the read-only YouTube fetcher.
// These pin the parts that are easy to get subtly wrong and expensive when
// wrong: URL parsing, pagination termination, quota classification, and
// videos.list batching.
jest.mock('@/lib/supabase/admin', () => ({ getAdminClient: jest.fn() }));
jest.mock('@/lib/hermes/hermes-logger', () => ({ hermesLog: jest.fn(), agentLog: jest.fn() }));

import {
  MAX_UPLOAD_PAGES,
  VIDEOS_LIST_BATCH_SIZE,
  YoutubeDataError,
  batchVideoIds,
  classifyYoutubeFailure,
  fetchVideoStats,
  isYoutubeDataConfigured,
  listUploadVideoIds,
  newLedger,
  parseChannelInput,
  resolveChannel,
  youtubeDataStatus,
} from '@/lib/content/youtube-data';

/* eslint-disable @typescript-eslint/no-explicit-any */

const realFetch = global.fetch;
const KEY = 'YOUTUBE_DATA_API_KEY';

function mockFetchSequence(responses: Array<{ ok?: boolean; status?: number; body: unknown }>) {
  const calls: URL[] = [];
  global.fetch = jest.fn(async (url: any) => {
    calls.push(new URL(String(url)));
    const next = responses.shift() ?? { body: {} };
    const ok = next.ok ?? true;
    return {
      ok,
      status: next.status ?? (ok ? 200 : 500),
      json: async () => next.body,
      text: async () => JSON.stringify(next.body),
    } as any;
  }) as any;
  return calls;
}

beforeEach(() => {
  process.env[KEY] = 'test-key';
});
afterEach(() => {
  global.fetch = realFetch;
  delete process.env[KEY];
  jest.restoreAllMocks();
});

// ── 1. URL / handle formats ────────────────────────────────────────────────

describe('parseChannelInput — all four formats', () => {
  it('resolves /channel/UC… to a direct id lookup', () => {
    expect(parseChannelInput('https://youtube.com/channel/UCabcdefghijklmnopqrstuv')).toEqual({
      kind: 'id',
      value: 'UCabcdefghijklmnopqrstuv',
    });
  });

  it('resolves /@handle and a bare @handle', () => {
    expect(parseChannelInput('https://www.youtube.com/@MyChannel')).toEqual({ kind: 'handle', value: 'MyChannel' });
    expect(parseChannelInput('@MyChannel')).toEqual({ kind: 'handle', value: 'MyChannel' });
  });

  it('resolves /user/LegacyName to the username filter', () => {
    expect(parseChannelInput('youtube.com/user/LegacyName')).toEqual({ kind: 'username', value: 'LegacyName' });
  });

  it('flags /c/CustomName as the custom kind (no cheap official lookup)', () => {
    expect(parseChannelInput('https://youtube.com/c/SomeCustom')).toEqual({ kind: 'custom', value: 'SomeCustom' });
  });

  it('accepts a bare channel id', () => {
    expect(parseChannelInput('UCabcdefghijklmnopqrstuv')).toEqual({ kind: 'id', value: 'UCabcdefghijklmnopqrstuv' });
  });

  it('rejects non-YouTube and unparseable input BEFORE any quota is spent', () => {
    for (const bad of ['', '   ', 'https://vimeo.com/channel/x', 'not a url', 'https://youtube.com/', 'https://evil.com/@x']) {
      expect(parseChannelInput(bad)).toBeNull();
    }
  });
});

describe('resolveChannel routes each kind to the right filter', () => {
  const channelBody = {
    items: [
      {
        id: 'UCxyz',
        snippet: { title: 'Test', customUrl: '@test', thumbnails: { high: { url: 'http://t/x.jpg' } } },
        statistics: { subscriberCount: '100', viewCount: '5000', videoCount: '12' },
        contentDetails: { relatedPlaylists: { uploads: 'UUxyz' } },
      },
    ],
  };

  it('uses forHandle for a handle (1 unit, no Search bucket)', async () => {
    const calls = mockFetchSequence([{ body: channelBody }]);
    const ledger = newLedger();
    const ch = await resolveChannel({ kind: 'handle', value: 'test' }, ledger);
    expect(calls[0].pathname).toContain('/channels');
    expect(calls[0].searchParams.get('forHandle')).toBe('test');
    expect(ledger.units).toBe(1);
    expect(ledger.searchCalls).toBe(0);
    expect(ch.uploadsPlaylistId).toBe('UUxyz');
  });

  it('uses forUsername for a legacy username', async () => {
    const calls = mockFetchSequence([{ body: channelBody }]);
    await resolveChannel({ kind: 'username', value: 'Legacy' }, newLedger());
    expect(calls[0].searchParams.get('forUsername')).toBe('Legacy');
  });

  it('spends exactly ONE Search-bucket call for a /c/ custom URL, then a normal channels.list', async () => {
    const calls = mockFetchSequence([
      { body: { items: [{ id: { channelId: 'UCxyz' } }] } },
      { body: channelBody },
    ]);
    const ledger = newLedger();
    await resolveChannel({ kind: 'custom', value: 'SomeCustom' }, ledger);
    expect(calls[0].pathname).toContain('/search');
    expect(calls[1].searchParams.get('id')).toBe('UCxyz');
    // Search is its own 100/day bucket — charged there, not to the main units.
    expect(ledger.searchCalls).toBe(1);
    expect(ledger.units).toBe(1);
  });

  it('reports not-found rather than returning an empty channel', async () => {
    mockFetchSequence([{ body: { items: [] } }]);
    await expect(resolveChannel({ kind: 'handle', value: 'nope' }, newLedger())).rejects.toMatchObject({
      kind: 'not-found',
    });
  });
});

// ── 2. Pagination termination ──────────────────────────────────────────────

describe('listUploadVideoIds — pagination must always terminate', () => {
  const page = (ids: string[], nextPageToken?: unknown) => ({
    body: { items: ids.map((id) => ({ contentDetails: { videoId: id } })), nextPageToken },
  });

  it('stops when nextPageToken is absent', async () => {
    mockFetchSequence([page(['a', 'b'])]);
    const ledger = newLedger();
    expect(await listUploadVideoIds('UU1', ledger, 50)).toEqual(['a', 'b']);
    expect(ledger.units).toBe(1);
  });

  it('stops on a MALFORMED nextPageToken instead of looping forever', async () => {
    // Non-string tokens are the realistic malformed case; a naive truthy check
    // would pass an object straight back into the next request.
    for (const malformed of [123, {}, [], true, '']) {
      const ledger = newLedger();
      mockFetchSequence([page(['a'], malformed), page(['b'])]);
      const ids = await listUploadVideoIds('UU1', ledger, 50);
      expect(ids).toEqual(['a']);
      expect(ledger.units).toBe(1);
    }
  });

  it('breaks a token CYCLE rather than paging forever', async () => {
    // Same token returned repeatedly — without cycle detection this never ends.
    const responses = Array.from({ length: 40 }, () => page(['x'], 'SAME_TOKEN'));
    const ledger = newLedger();
    mockFetchSequence(responses);
    await listUploadVideoIds('UU1', ledger, 1000);
    expect(ledger.units).toBe(2); // first page + one repeat, then the cycle is caught
  });

  it('never exceeds the hard page ceiling even with unique tokens', async () => {
    const responses = Array.from({ length: 100 }, (_, i) => page([`v${i}`], `tok-${i}`));
    const ledger = newLedger();
    mockFetchSequence(responses);
    await listUploadVideoIds('UU1', ledger, 10_000);
    expect(ledger.units).toBeLessThanOrEqual(MAX_UPLOAD_PAGES);
  });

  it('stops on an empty page', async () => {
    mockFetchSequence([page([], 'tok')]);
    const ledger = newLedger();
    expect(await listUploadVideoIds('UU1', ledger, 50)).toEqual([]);
    expect(ledger.units).toBe(1);
  });

  it('honors the requested limit', async () => {
    mockFetchSequence([page(['a', 'b', 'c', 'd'])]);
    expect(await listUploadVideoIds('UU1', newLedger(), 2)).toEqual(['a', 'b']);
  });
});

// ── 3. Quota exhaustion degrades, never crashes ────────────────────────────

describe('quotaExceeded surfaces as a typed error, not an unhandled throw', () => {
  it('classifies a 403 quotaExceeded body', () => {
    const err = classifyYoutubeFailure(403, JSON.stringify({ error: { errors: [{ reason: 'quotaExceeded' }] } }));
    expect(err).toBeInstanceOf(YoutubeDataError);
    expect(err.kind).toBe('quota-exceeded');
    expect(err.message).toMatch(/quota/i);
  });

  it('classifies dailyLimitExceeded the same way', () => {
    expect(classifyYoutubeFailure(403, '{"error":{"errors":[{"reason":"dailyLimitExceeded"}]}}').kind).toBe('quota-exceeded');
  });

  it('does NOT mistake a plain 403 for a quota wall', () => {
    expect(classifyYoutubeFailure(403, '{"error":"keyInvalid"}').kind).toBe('api-error');
  });

  it('maps 404 and other statuses distinctly', () => {
    expect(classifyYoutubeFailure(404, '').kind).toBe('not-found');
    expect(classifyYoutubeFailure(500, 'boom').kind).toBe('api-error');
  });

  it('propagates a quota wall mid-pagination as a typed error, and still charges the attempt', async () => {
    const ledger = newLedger();
    mockFetchSequence([
      { body: { items: [{ contentDetails: { videoId: 'a' } }], nextPageToken: 'tok' } },
      { ok: false, status: 403, body: { error: { errors: [{ reason: 'quotaExceeded' }] } } },
    ]);
    await expect(listUploadVideoIds('UU1', ledger, 500)).rejects.toMatchObject({ kind: 'quota-exceeded' });
    expect(ledger.units).toBe(2); // the failed call consumed quota too
  });

  it('refuses to call the API at all without a key', async () => {
    delete process.env[KEY];
    expect(isYoutubeDataConfigured()).toBe(false);
    expect(youtubeDataStatus().missing).toEqual([KEY]);
    await expect(listUploadVideoIds('UU1', newLedger(), 10)).rejects.toMatchObject({ kind: 'not-configured' });
  });
});

// ── 4. videos.list batches, never one call per video ───────────────────────

describe('fetchVideoStats batches ids', () => {
  it('splits at the 50-id batch size', () => {
    const ids = Array.from({ length: 120 }, (_, i) => `v${i}`);
    const batches = batchVideoIds(ids);
    expect(VIDEOS_LIST_BATCH_SIZE).toBe(50);
    expect(batches.map((b) => b.length)).toEqual([50, 50, 20]);
    expect(batches.flat()).toEqual(ids); // nothing dropped or duplicated
  });

  it('spends ONE unit for 50 videos, not fifty', async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `v${i}`);
    const calls = mockFetchSequence([{ body: { items: [] } }]);
    const ledger = newLedger();
    await fetchVideoStats(ids, ledger);
    expect(ledger.units).toBe(1);
    expect(calls).toHaveLength(1);
    // All 50 ids ride in one comma-separated id parameter.
    expect(calls[0].searchParams.get('id')?.split(',')).toHaveLength(50);
  });

  it('spends two units for 51 videos', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `v${i}`);
    const ledger = newLedger();
    mockFetchSequence([{ body: { items: [] } }, { body: { items: [] } }]);
    await fetchVideoStats(ids, ledger);
    expect(ledger.units).toBe(2);
  });

  it('costs nothing for an empty id list', async () => {
    const ledger = newLedger();
    mockFetchSequence([]);
    expect(await fetchVideoStats([], ledger)).toEqual([]);
    expect(ledger.units).toBe(0);
  });

  it('maps statistics into the row shape', async () => {
    mockFetchSequence([
      {
        body: {
          items: [
            {
              id: 'v1',
              snippet: { title: 'T', publishedAt: '2026-01-01T00:00:00Z', thumbnails: { medium: { url: 'u' } } },
              statistics: { viewCount: '10', likeCount: '2', commentCount: '1' },
            },
          ],
        },
      },
    ]);
    const [row] = await fetchVideoStats(['v1'], newLedger());
    expect(row).toMatchObject({ externalVideoId: 'v1', title: 'T', viewCount: 10, likeCount: 2, commentCount: 1 });
  });
});

// ── Realistic refresh cost ─────────────────────────────────────────────────

describe('quota cost of a realistic refresh', () => {
  it('is 3 units for one channel with 20 videos', async () => {
    const ledger = newLedger();
    mockFetchSequence([
      { body: { items: [{ id: 'UCx', snippet: {}, statistics: {}, contentDetails: { relatedPlaylists: { uploads: 'UUx' } } }] } },
      { body: { items: Array.from({ length: 20 }, (_, i) => ({ contentDetails: { videoId: `v${i}` } })) } },
      { body: { items: [] } },
    ]);
    const ch = await resolveChannel({ kind: 'id', value: 'UCx' }, ledger);
    const ids = await listUploadVideoIds(ch.uploadsPlaylistId!, ledger, 20);
    await fetchVideoStats(ids, ledger);
    // channels.list 1 + playlistItems.list 1 + videos.list 1
    expect(ledger.units).toBe(3);
    expect(ledger.searchCalls).toBe(0);
  });
});

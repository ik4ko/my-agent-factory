// content_sync loop body — the hourly YouTube refresh.
//
// The properties that matter: it spends NO tokens (must never reach the
// brain-decision branch), one channel's failure must not abort the sweep, a
// missing API key is a skip rather than a failure, and the quota it reports
// must be the quota actually consumed.
jest.mock('@/lib/supabase/admin', () => ({ getAdminClient: jest.fn() }));
jest.mock('@/lib/hermes/hermes-logger', () => ({ hermesLog: jest.fn(), agentLog: jest.fn() }));
jest.mock('@/lib/content/channel-links', () => ({ listLinks: jest.fn(), refreshLink: jest.fn() }));
jest.mock('@/lib/content/youtube-data', () => ({ isYoutubeDataConfigured: jest.fn(() => true) }));
// The brain must never be consulted for this kind — if the dispatch ever falls
// through to the LLM branch, this mock makes it a loud failure.
jest.mock('@/lib/agents/registry', () => ({
  AgentRegistry: {},
  resolveAgent: jest.fn(() => {
    throw new Error('content_sync must not consult a brain');
  }),
}));

import { runLoop } from '@/lib/loops/engine';
import { getAdminClient } from '@/lib/supabase/admin';
import { listLinks, refreshLink } from '@/lib/content/channel-links';
import { isYoutubeDataConfigured } from '@/lib/content/youtube-data';
import type { LoopRow } from '@/lib/types/database.types';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Captures every loop_runs update so assertions can read the audit row. */
function mockDb() {
  const updates: any[] = [];
  const chain = (result: any = { data: null, error: null }): any => {
    const c: any = {};
    for (const m of ['select', 'eq', 'in', 'insert', 'update', 'limit', 'order']) c[m] = jest.fn(() => c);
    c.single = jest.fn(async () => result);
    c.maybeSingle = jest.fn(async () => result);
    c.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
    return c;
  };
  const db: any = {
    from: jest.fn((table: string) => {
      const c = chain(
        table === 'loop_runs'
          ? { data: { id: 'run-1' }, error: null }
          : table === 'content_channels'
            ? { data: [{ id: 'ch-a', slug: 'faceless' }], error: null }
            : { data: null, error: null },
      );
      if (table === 'loop_runs') {
        const origUpdate = c.update;
        c.update = jest.fn((payload: any) => {
          updates.push(payload);
          return origUpdate(payload);
        });
      }
      return c;
    }),
  };
  (getAdminClient as jest.Mock).mockReturnValue(db);
  return { updates };
}

const loop = (over: Partial<LoopRow> = {}): LoopRow => ({
  id: 'loop-1',
  name: 'YouTube channel sync',
  kind: 'content_sync',
  objective: 'Refresh connected channels.',
  status: 'armed',
  cadence_seconds: 3600,
  triggers: [],
  config: {},
  brain: 'claude',
  last_tick_at: null,
  next_tick_at: null,
  lock_owner: null,
  lock_at: null,
  created_at: '',
  updated_at: '',
  ...over,
});

const link = (id: string, channelId = 'ch-a') => ({
  id,
  channel_id: channelId,
  platform: 'youtube',
  handle: null,
  external_id: 'UCx',
  connected_at: '',
  last_synced_at: null,
  last_error: null,
});

/** The final loop_runs update — the completed/failed audit row. */
const finalRow = (updates: any[]) => updates[updates.length - 1];

beforeEach(() => {
  jest.clearAllMocks();
  (isYoutubeDataConfigured as jest.Mock).mockReturnValue(true);
});

describe('content_sync loop', () => {
  it('refreshes every connected link and reports the real quota spent', async () => {
    const { updates } = mockDb();
    (listLinks as jest.Mock).mockResolvedValue([link('l1'), link('l2'), link('l3')]);
    (refreshLink as jest.Mock).mockResolvedValue({ ok: true, quota: { units: 3, searchCalls: 0, calls: [] }, videoCount: 20 });

    await runLoop(loop(), null);

    expect(refreshLink).toHaveBeenCalledTimes(3);
    const row = finalRow(updates);
    expect(row.status).toBe('completed');
    expect(row.result).toMatchObject({ executed: true, synced: 3, failed: 0, quotaUnits: 9 });
    // 3 units x 3 channels — the number the quota budget was justified on.
    expect(row.result.quotaUnits).toBe(9);
  });

  it('does NOT abort the sweep when one channel fails', async () => {
    const { updates } = mockDb();
    (listLinks as jest.Mock).mockResolvedValue([link('l1'), link('l2'), link('l3')]);
    (refreshLink as jest.Mock)
      .mockResolvedValueOnce({ ok: true, quota: { units: 3, searchCalls: 0, calls: [] }, videoCount: 20 })
      .mockResolvedValueOnce({ ok: false, quota: { units: 1, searchCalls: 0, calls: [] }, error: 'quota exceeded' })
      .mockResolvedValueOnce({ ok: true, quota: { units: 3, searchCalls: 0, calls: [] }, videoCount: 12 });

    await runLoop(loop(), null);

    // The third link still synced despite the second failing.
    expect(refreshLink).toHaveBeenCalledTimes(3);
    const row = finalRow(updates);
    expect(row.status).toBe('completed'); // a partial sweep is still a completed run
    expect(row.result).toMatchObject({ synced: 2, failed: 1, quotaUnits: 7 });
    expect(row.actions.find((a: any) => !a.ok)).toMatchObject({ linkId: 'l2', error: 'quota exceeded' });
  });

  it('skips cleanly — not fails — when the API key is absent', async () => {
    const { updates } = mockDb();
    (isYoutubeDataConfigured as jest.Mock).mockReturnValue(false);
    (listLinks as jest.Mock).mockResolvedValue([link('l1')]);

    await runLoop(loop(), null);

    expect(refreshLink).not.toHaveBeenCalled();
    const row = finalRow(updates);
    expect(row.status).toBe('completed');
    expect(row.result).toMatchObject({ executed: false, links: 0 });
    expect(row.decision.skipped).toMatch(/YOUTUBE_DATA_API_KEY/);
  });

  it('is a no-op with zero connected links — no quota, no error', async () => {
    const { updates } = mockDb();
    (listLinks as jest.Mock).mockResolvedValue([]);

    await runLoop(loop(), null);

    expect(refreshLink).not.toHaveBeenCalled();
    expect(finalRow(updates).result).toMatchObject({ executed: true, synced: 0, failed: 0, quotaUnits: 0 });
  });

  it('narrows to config.channelSlugs when provided', async () => {
    const { updates } = mockDb();
    // The mocked content_channels lookup resolves 'faceless' -> ch-a only.
    (listLinks as jest.Mock).mockResolvedValue([link('l1', 'ch-a'), link('l2', 'ch-b')]);
    (refreshLink as jest.Mock).mockResolvedValue({ ok: true, quota: { units: 3, searchCalls: 0, calls: [] }, videoCount: 5 });

    await runLoop(loop({ config: { channelSlugs: ['faceless'] } }), null);

    expect(refreshLink).toHaveBeenCalledTimes(1);
    expect(refreshLink).toHaveBeenCalledWith('l1');
    expect(finalRow(updates).decision).toMatchObject({ scope: ['faceless'] });
  });

  it('ignores a malformed channelSlugs config rather than throwing', async () => {
    const { updates } = mockDb();
    (listLinks as jest.Mock).mockResolvedValue([link('l1'), link('l2')]);
    (refreshLink as jest.Mock).mockResolvedValue({ ok: true, quota: { units: 3, searchCalls: 0, calls: [] }, videoCount: 1 });

    // Not an array — must fall back to "all links", not crash the worker.
    await runLoop(loop({ config: { channelSlugs: 'faceless' } }), null);

    expect(refreshLink).toHaveBeenCalledTimes(2);
    expect(finalRow(updates).status).toBe('completed');
  });
});

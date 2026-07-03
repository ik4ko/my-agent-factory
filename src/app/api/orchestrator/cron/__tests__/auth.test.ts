// Cron authorization surface — verifies CRON_SECRET gating without spinning up
// the DB (triage/reaper are mocked). Focus: only a correct secret passes, via
// either Bearer or x-cron-secret; unset secret fails closed.
jest.mock('@/lib/agents/orchestrator', () => ({
  triageTick: jest.fn(async () => ({ scanned: 0, locked: 0, skipped: 0, halted: false, dispatches: [] })),
}));
jest.mock('@/lib/agents/reaper', () => ({ clearStaleLocks: jest.fn(async () => ({ scanned: 0, recycled: 0 })) }));

import { GET } from '@/app/api/orchestrator/cron/route';
import { triageTick } from '@/lib/agents/orchestrator';
import { clearStaleLocks } from '@/lib/agents/reaper';

function req(headers: Record<string, string> = {}) {
  return { headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } } as unknown as Parameters<typeof GET>[0];
}

const OLD = process.env.CRON_SECRET;
afterEach(() => { process.env.CRON_SECRET = OLD; });

describe('cron authorization', () => {
  it('401s when no secret is configured (fail closed)', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req({ authorization: 'Bearer whatever' }));
    expect(res.status).toBe(401);
    expect(triageTick).not.toHaveBeenCalled();
  });

  it('401s on a wrong secret', async () => {
    process.env.CRON_SECRET = 'right';
    const res = await GET(req({ authorization: 'Bearer wrong' }));
    expect(res.status).toBe(401);
  });

  it('runs reaper then triage on a correct Bearer token', async () => {
    process.env.CRON_SECRET = 'right';
    const res = await GET(req({ authorization: 'Bearer right' }));
    expect(res.status).toBe(200);
    expect(clearStaleLocks).toHaveBeenCalledTimes(1);
    expect(triageTick).toHaveBeenCalledTimes(1);
  });

  it('accepts the x-cron-secret header form', async () => {
    process.env.CRON_SECRET = 'right';
    const res = await GET(req({ 'x-cron-secret': 'right' }));
    expect(res.status).toBe(200);
  });
});

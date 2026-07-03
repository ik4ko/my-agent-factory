// clearStaleLocks unit tests with a chainable mocked Supabase admin client.
jest.mock('@/lib/supabase/admin', () => ({ getAdminClient: jest.fn() }));
jest.mock('@/lib/hermes/hermes-logger', () => ({ hermesLog: jest.fn() }));
jest.mock('@/lib/telemetry/token-ledger', () => ({ recordModelEvent: jest.fn() }));

import { clearStaleLocks } from '@/lib/agents/reaper';
import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { recordModelEvent } from '@/lib/telemetry/token-ledger';

/* eslint-disable @typescript-eslint/no-explicit-any */

type ChainResult = { data?: unknown; error?: { message: string } | null };

function chain(result: ChainResult) {
  const c: any = {};
  for (const m of ['select', 'update', 'eq', 'lt', 'limit']) c[m] = jest.fn(() => c);
  c.then = (res: any, rej: any) => Promise.resolve({ error: null, ...result }).then(res, rej);
  return c;
}

function mockDb(plan: Record<string, ChainResult[]>) {
  const calls: Record<string, any[]> = {};
  const db = {
    from: jest.fn((table: string) => {
      const next = plan[table]?.shift() ?? { data: null, error: null };
      const c = chain(next);
      (calls[table] ??= []).push(c);
      return c;
    }),
  };
  (getAdminClient as jest.Mock).mockReturnValue(db);
  return { db, calls };
}

const staleTask = {
  id: '11111111-aaaa-bbbb-cccc-000000000001',
  agent_id: '22222222-aaaa-bbbb-cccc-000000000002',
  description: 'critical migration',
  status: 'running',
  model: 'claude-opus-4-8',
  created_at: '2026-07-03T00:00:00Z',
  updated_at: '2026-07-03T00:00:10Z',
};

describe('clearStaleLocks', () => {
  it('recycles a stale running task and frees the holding agent', async () => {
    const { calls } = mockDb({
      tasks: [{ data: [staleTask] }, { data: null }], // scan, then update
      agents: [{ data: null }],
    });

    const result = await clearStaleLocks(3);

    expect(result).toEqual({ scanned: 1, recycled: 1 });
    // task reverted to pending, guarded on status=running
    const taskUpdate = calls.tasks[1];
    expect(taskUpdate.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', result: null }));
    expect(taskUpdate.eq).toHaveBeenCalledWith('id', staleTask.id);
    expect(taskUpdate.eq).toHaveBeenCalledWith('status', 'running');
    // agent freed by current_task_id match (handles orphaned locks)
    const agentUpdate = calls.agents[0];
    expect(agentUpdate.update).toHaveBeenCalledWith({ status: 'idle', current_task_id: null });
    expect(agentUpdate.eq).toHaveBeenCalledWith('current_task_id', staleTask.id);
    // telemetry + single-line recovery log
    expect(recordModelEvent).toHaveBeenCalledWith(expect.objectContaining({ event: 'REAP', taskId: staleTask.id }));
    expect(hermesLog).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('RECOVERY: Agent heartbeat timeout. Task recycled to pending.'),
      staleTask.agent_id
    );
  });

  it('scans with the running-status + updated_at cutoff filters', async () => {
    const { calls } = mockDb({ tasks: [{ data: [] }] });
    const result = await clearStaleLocks(3);
    expect(result).toEqual({ scanned: 0, recycled: 0 });
    const scan = calls.tasks[0];
    expect(scan.eq).toHaveBeenCalledWith('status', 'running');
    expect(scan.lt).toHaveBeenCalledWith('updated_at', expect.any(String));
    const cutoff = new Date(scan.lt.mock.calls[0][1]).getTime();
    expect(Date.now() - cutoff).toBeGreaterThanOrEqual(3 * 60_000 - 1_000);
    expect(recordModelEvent).not.toHaveBeenCalled();
  });

  it('never throws when the scan fails — logs a single-line HALT instead', async () => {
    mockDb({ tasks: [{ data: null, error: { message: 'network exploded' } }] });
    const result = await clearStaleLocks(3);
    expect(result).toEqual({ scanned: 0, recycled: 0 });
    expect(hermesLog).toHaveBeenCalledWith('error', expect.stringContaining('[REAPER] HALT'));
  });

  it('skips (not counts) a task whose recycle update fails, continues batch', async () => {
    const other = { ...staleTask, id: '33333333-aaaa-bbbb-cccc-000000000003' };
    mockDb({
      tasks: [
        { data: [staleTask, other] },
        { data: null, error: { message: 'row locked' } }, // first recycle fails
        { data: null }, // second succeeds
      ],
      agents: [{ data: null }, { data: null }],
    });
    const result = await clearStaleLocks(3);
    expect(result).toEqual({ scanned: 2, recycled: 1 });
  });
});

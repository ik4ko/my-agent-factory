const executeToolCallsMock: jest.Mock = jest.fn(async () => [{ tool: 'write_file', ok: true, summary: 'wrote once' }]);
const claimActionMock: jest.Mock = jest.fn();
const finishActionMock: jest.Mock = jest.fn(async () => undefined);

jest.mock('@/lib/sandbox/parser', () => ({ parseToolCalls: () => ({ calls: [{ tool: 'write_file', path: 'x', content: 'y' }], errors: [] }) }));
jest.mock('@/lib/sandbox/runner', () => ({
  executeToolCalls: (...args: unknown[]) => executeToolCallsMock(...args),
  formatToolResults: () => 'done',
}));
jest.mock('@/lib/idempotency/claims', () => ({
  claimAction: (...args: unknown[]) => claimActionMock(...args),
  finishAction: (...args: unknown[]) => finishActionMock(...args),
}));
jest.mock('@/lib/hermes/hermes-logger', () => ({ hermesLog: jest.fn(async () => undefined) }));
jest.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({
      data: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', assigned_lane: 'UP', agent_id: null, result: null }, error: null,
    }) }) }) }),
  }),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/tasks/execute/route';

describe('task tool execution replay protection', () => {
  it('returns the durable first response without executing a tool batch twice', async () => {
    const completed = { executed: 1, results: [{ tool: 'write_file', ok: true, summary: 'wrote once' }], parseErrors: [], feedback: 'done' };
    claimActionMock
      .mockResolvedValueOnce({ claimed: true })
      .mockResolvedValueOnce({ claimed: false, status: 'completed', response: completed });
    const body = { taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', executionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', text: 'tool call' };
    const makeReq = () => new NextRequest('https://factory.test/api/tasks/execute', { method: 'POST', body: JSON.stringify(body) });

    expect((await POST(makeReq())).status).toBe(200);
    const replay = await POST(makeReq());
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(completed);
    expect(executeToolCallsMock).toHaveBeenCalledTimes(1);
    expect(finishActionMock).toHaveBeenCalledTimes(1);
  });
});

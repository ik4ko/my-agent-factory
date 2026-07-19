const rpcMock = jest.fn();
const logInsertMock = jest.fn(async () => ({ error: null }));
jest.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({ rpc: (...args: unknown[]) => rpcMock(...args), from: () => ({ insert: logInsertMock }) }),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/control/task-intervention/route';

const body = { taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', decision: 'approve' };
const request = () => new NextRequest('https://factory.test/api/control/task-intervention', { method: 'POST', body: JSON.stringify(body) });

describe('atomic task intervention', () => {
  it('refuses an already-decided task instead of reversing it', async () => {
    rpcMock.mockResolvedValueOnce({ data: false, error: null });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(logInsertMock).not.toHaveBeenCalled();
  });

  it('audits a successful pending-only decision', async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith('decide_task_intervention', expect.objectContaining({ p_decision: 'approve' }));
    expect(logInsertMock).toHaveBeenCalledTimes(1);
  });
});

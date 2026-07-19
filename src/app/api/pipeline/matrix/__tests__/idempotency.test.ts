const afterMock = jest.fn();
jest.mock('next/server', () => ({ ...jest.requireActual('next/server'), after: (...args: unknown[]) => afterMock(...args) }));
const claimActionMock: jest.Mock = jest.fn();
const finishActionMock: jest.Mock = jest.fn(async () => undefined);
jest.mock('@/lib/idempotency/claims', () => ({
  claimAction: (...args: unknown[]) => claimActionMock(...args),
  finishAction: (...args: unknown[]) => finishActionMock(...args),
}));
jest.mock('@/lib/pipeline/parallel-matrix', () => ({ runParallelMatrix: jest.fn(async () => undefined) }));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/pipeline/matrix/route';

describe('paid matrix idempotency', () => {
  it('schedules background paid work only for the first delivery', async () => {
    const response = { accepted: true, simulate: false };
    claimActionMock
      .mockResolvedValueOnce({ claimed: true })
      .mockResolvedValueOnce({ claimed: false, status: 'completed', response });
    const request = () => new NextRequest('https://factory.test/api/pipeline/matrix', {
      method: 'POST', headers: { 'Idempotency-Key': 'matrix-request-1' },
      body: JSON.stringify({ objective: 'analyze', simulate: false }),
    });
    expect((await POST(request())).status).toBe(200);
    expect((await POST(request())).status).toBe(200);
    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(finishActionMock).toHaveBeenCalledTimes(1);
  });
});


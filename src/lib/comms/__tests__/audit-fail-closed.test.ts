const singleMock = jest.fn();
jest.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({ from: () => ({ insert: () => ({ select: () => ({ single: singleMock }) }) }) }),
}));
jest.mock('@/lib/hermes/hermes-logger', () => ({ hermesLog: jest.fn(async () => undefined) }));

import { sendEmail } from '@/lib/comms/email';

describe('outbound delivery audit claims', () => {
  const originalFetch = global.fetch;
  const oldEnv = { ...process.env };
  beforeEach(() => {
    process.env.GMAIL_USER = 'operator@example.com';
    process.env.GMAIL_APP_PASSWORD = 'secret';
    global.fetch = jest.fn();
    singleMock.mockResolvedValue({ data: null, error: { message: 'database unavailable' } });
  });
  afterAll(() => {
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env, oldEnv);
    global.fetch = originalFetch;
  });

  it('does not send email when its durable audit row cannot be claimed', async () => {
    const result = await sendEmail({ to: 'person@example.com', subject: 'x', body: 'y' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/audit claim failed/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

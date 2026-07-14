import { classifyNvidiaFailure } from '../nvidia-errors';

describe('classifyNvidiaFailure — the free-tier failure modes are distinct', () => {
  it('429 → rate-limit, plainly worded', () => {
    const f = classifyNvidiaFailure(429, 'Too Many Requests');
    expect(f.kind).toBe('rate-limit');
    expect(f.reason).toMatch(/40 requests\/min/);
    expect(f.reason).toMatch(/no fallback/);
  });

  it('402 → credits-exhausted regardless of message body', () => {
    const f = classifyNvidiaFailure(402, '');
    expect(f.kind).toBe('credits-exhausted');
    expect(f.reason).toMatch(/build\.nvidia\.com/);
  });

  it('403 with a credit/quota message → credits-exhausted', () => {
    for (const msg of ['Account credits exhausted', 'quota exceeded', 'insufficient balance']) {
      expect(classifyNvidiaFailure(403, msg).kind).toBe('credits-exhausted');
    }
  });

  it('403 WITHOUT a credit message stays a generic auth error — never misreported as exhaustion', () => {
    const f = classifyNvidiaFailure(403, 'Authorization failed');
    expect(f.kind).toBe('api-error');
    expect(f.reason).toMatch(/403/);
  });

  it('other statuses → generic api-error carrying the status and message', () => {
    const f = classifyNvidiaFailure(500, 'internal');
    expect(f.kind).toBe('api-error');
    expect(f.reason).toBe('NVIDIA API 500: internal');
    expect(classifyNvidiaFailure(400, '').reason).toMatch(/request failed/);
  });
});

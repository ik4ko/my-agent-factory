import {
  createSessionToken,
  verifySessionToken,
  timingSafeEqualStr,
  SESSION_TTL_MS,
} from '@/lib/auth/session';

const PW = 'correct-horse-battery-staple';

describe('session token', () => {
  it('round-trips a valid token', async () => {
    const token = await createSessionToken(PW);
    expect(await verifySessionToken(token, PW)).toBe(true);
  });

  it('rejects a token signed with a different password', async () => {
    const token = await createSessionToken('other-password');
    expect(await verifySessionToken(token, PW)).toBe(false);
  });

  it('rejects an expired token', async () => {
    const issued = Date.now() - SESSION_TTL_MS - 1000;
    const token = await createSessionToken(PW, issued);
    expect(await verifySessionToken(token, PW)).toBe(false);
  });

  it('rejects tampered expiry', async () => {
    const token = await createSessionToken(PW);
    const [, sig] = token.split('.');
    const forged = `${Date.now() + SESSION_TTL_MS * 52}.${sig}`;
    expect(await verifySessionToken(forged, PW)).toBe(false);
  });

  it('rejects malformed/absent tokens', async () => {
    for (const bad of [undefined, '', '.', 'abc', '123', '123.', '.deadbeef', 'x.y']) {
      expect(await verifySessionToken(bad as string | undefined, PW)).toBe(false);
    }
  });

  it('timingSafeEqualStr compares correctly', () => {
    expect(timingSafeEqualStr('abc', 'abc')).toBe(true);
    expect(timingSafeEqualStr('abc', 'abd')).toBe(false);
    expect(timingSafeEqualStr('abc', 'abcd')).toBe(false);
    expect(timingSafeEqualStr('', '')).toBe(true);
  });
});

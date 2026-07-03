// Edge-safe session token helpers (Web Crypto only — runs in middleware).
// Token format: "<expiresAtMs>.<hex hmac-sha256(expiresAtMs, key=DASHBOARD_PASSWORD)>"

export const SESSION_COOKIE = 'hermes_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function hmacHex(message: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Constant-time string comparison (edge runtime has no timingSafeEqual). */
export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionToken(password: string, now = Date.now()): Promise<string> {
  const exp = String(now + SESSION_TTL_MS);
  return `${exp}.${await hmacHex(exp, password)}`;
}

export async function verifySessionToken(
  token: string | undefined,
  password: string,
  now = Date.now()
): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < now) return false;
  const expected = await hmacHex(exp, password);
  return timingSafeEqualStr(sig, expected);
}

import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Twilio request-signature validation (no SDK dependency — this is the
 * whole documented algorithm): sort POST params by key, append each
 * key+value directly to the full request URL (no separators), HMAC-SHA1
 * with the auth token, base64-encode, compare to X-Twilio-Signature.
 *
 * The URL must be EXACTLY what Twilio requested (scheme+host+path+query) —
 * behind a reverse proxy this may need PUBLIC_BASE_URL to override the
 * request's own inferred origin. Verify against real Twilio traffic once
 * TWILIO_* is configured; this is untested against a live webhook today.
 */
export function validateTwilioSignature(url: string, params: Record<string, string>, signature: string, authToken: string): boolean {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((key) => key + params[key])
      .join('');
  const expected = createHmac('sha1', authToken).update(data, 'utf8').digest('base64');

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

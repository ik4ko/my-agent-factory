// NVIDIA free-tier failure classification — pure and unit-tested
// (src/lib/agents/__tests__/nvidia-errors.test.ts), because these two
// failure modes are the entire point of the experimental lane: a finite
// credit pool WILL run dry and 40 RPM WILL be hit, and each must surface as
// its own plainly-worded, expected outcome — never a generic dispatch error.
// Kept outside the 'use server' dispatcher module so it can be imported by
// tests (server-action files may only export async functions).

export interface NvidiaFailure {
  kind: 'rate-limit' | 'credits-exhausted' | 'api-error';
  /** Operator-facing message, shown verbatim in the chat bubble. */
  reason: string;
}

export function classifyNvidiaFailure(status: number, apiMessage: string): NvidiaFailure {
  if (status === 429) {
    return {
      kind: 'rate-limit',
      reason: 'NVIDIA free-tier rate limit hit (40 requests/min) — wait a minute and retry; no fallback by contract',
    };
  }
  if (status === 402 || (status === 403 && /credit|quota|exhaust|balance/i.test(apiMessage))) {
    return {
      kind: 'credits-exhausted',
      reason: 'NVIDIA free-tier credits exhausted — request more at build.nvidia.com; no fallback by contract',
    };
  }
  return { kind: 'api-error', reason: `NVIDIA API ${status}: ${apiMessage || 'request failed'}` };
}

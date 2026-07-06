// Minimal in-memory rate limiter for privileged control endpoints
// (arm/kill/halt/comms-simulate). Per-process, per-key sliding window — good
// enough to blunt a runaway script or a stuck retry loop; not a substitute
// for the PIN gate, just defense-in-depth alongside it.
const HITS = new Map<string, number[]>();

export function rateLimited(key: string, maxPerMinute = 10): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;
  const hits = (HITS.get(key) ?? []).filter((t) => t > windowStart);
  if (hits.length >= maxPerMinute) {
    HITS.set(key, hits);
    return true;
  }
  hits.push(now);
  HITS.set(key, hits);
  return false;
}

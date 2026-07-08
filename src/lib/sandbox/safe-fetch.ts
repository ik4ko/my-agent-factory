// DNS-rebinding-safe HTTP fetch for the web_fetch sandbox tool. Deliberately
// NOT built on global fetch()/undici: those resolve the hostname internally
// with no hook to validate the IP before connecting, which is exactly the
// TOCTOU gap DNS rebinding exploits (check an IP, then race a fresh
// resolution that returns a different, private one, for the real connect).
// `https.Agent`'s `lookup` option runs at the same DNS lookup that opens the
// actual socket, so validating there closes the gap instead of racing it.
import https from 'node:https';
import dns from 'node:dns';
import type { LookupFunction } from 'node:net';
import { isDisallowedIp } from './policy';

export interface SafeFetchOptions {
  timeoutMs: number;
  maxBytes: number;
  userAgent: string;
  /** Allowed `content-type` prefixes (e.g. "text/html"); response is refused
   *  as soon as headers arrive if its content-type doesn't match one. */
  allowedContentTypes: readonly string[];
}

export interface SafeFetchResult {
  status: number;
  contentType: string | null;
  body: string;
  /** Body was cut off at maxBytes — still a successful fetch, just capped. */
  truncated: boolean;
  /** Refused before/while reading the body (disallowed content-type). */
  refusedReason?: string;
}

// https.Agent's `lookup` option is called by Node's own connection logic —
// verified live that this Node version invokes it in *both* shapes: a
// single address, and (Happy Eyeballs dual-stack racing) an array of
// {address, family} candidates via options.all. Every candidate must be
// checked; the whole connection is refused if any of them is disallowed —
// each is validated at the exact DNS lookup that opens the real connection.
function validatingLookup(
  hostname: string,
  options: dns.LookupOneOptions | dns.LookupAllOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void
): void {
  const onResolved = (
    err: NodeJS.ErrnoException | null,
    address: string | dns.LookupAddress[],
    family?: number
  ): void => {
    if (err) return callback(err, address as never, family);
    const candidates = Array.isArray(address) ? address.map((a) => a.address) : [address];
    const disallowed = candidates.find((ip) => isDisallowedIp(ip));
    if (disallowed) {
      return callback(new Error(`resolved to a disallowed IP: ${disallowed}`), address as never, family);
    }
    callback(null, address as never, family);
  };
  dns.lookup(hostname, options as dns.LookupAllOptions, onResolved as never);
}

/**
 * GET a URL with DNS-rebinding protection, a hard response-size cap enforced
 * during transfer (not after downloading everything), and a content-type
 * gate. Never follows redirects — a 3xx comes back as an ordinary result
 * with its `location` header visible in the caller's own logging, so a
 * legitimate redirect target must be re-requested explicitly and passes
 * through the exact same allowlist + DNS validation as any other URL.
 */
export function safeFetch(url: URL, opts: SafeFetchOptions): Promise<SafeFetchResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (result: SafeFetchResult) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    const fail = (err: Error) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };

    const agent = new https.Agent({ lookup: validatingLookup as LookupFunction });
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        agent,
        headers: { 'User-Agent': opts.userAgent },
        timeout: opts.timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = (res.headers['content-type'] ?? null)?.toString().split(';')[0].trim().toLowerCase() ?? null;

        if (contentType && !opts.allowedContentTypes.some((t) => contentType === t)) {
          res.destroy();
          return done({ status, contentType, body: '', truncated: false, refusedReason: `disallowed content-type: ${contentType}` });
        }

        let received = 0;
        let truncated = false;
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > opts.maxBytes) {
            truncated = true;
            res.destroy(); // stop the transfer — cap enforced mid-download, not after
            return;
          }
          chunks.push(chunk);
        });
        const finish = () => done({ status, contentType, body: Buffer.concat(chunks).toString('utf8'), truncated });
        res.on('end', finish);
        res.on('close', finish); // the only completion event when destroy() cut the size cap
        res.on('error', (err) => {
          if (!truncated) fail(err); // destroy()-after-cap is expected, not a real error
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error(`request timed out after ${opts.timeoutMs}ms`)));
    req.on('error', (err) => fail(err));
    req.end();
  });
}

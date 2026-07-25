// Sandbox security policy — the real boundary. Two hard rules, both allowlist-
// based (denylists for shell execution are unclosable and give false safety):
//
//   1. execute_command: exact-argv allowlist, NO shell interpretation, child
//      env scrubbed of every secret. The app's process.env holds the Supabase
//      service-role key + Anthropic key + dashboard password; nothing the
//      sandbox spawns may see them.
//   2. file ops: resolved path must stay inside SANDBOX_ROOT (realpath-checked
//      so symlinks can't escape).
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import type { RoomScope } from '@/lib/rooms/scope';

export function sandboxRoot(): string {
  const configuredRoot = process.env.SANDBOX_ROOT?.trim();
  const root = configuredRoot ? path.resolve(configuredRoot) : path.resolve('.sandbox');
  fs.mkdirSync(root, { recursive: true });
  return fs.realpathSync(root);
}

export interface PathCheck {
  ok: boolean;
  resolved?: string;
  reason?: string;
}

/**
 * Confine `target` to the sandbox root. For writes, `mustExist=false` checks
 * the nearest existing ancestor's realpath so a symlinked parent can't escape.
 */
export function confinePath(target: string, mustExist = false): PathCheck {
  const root = sandboxRoot();
  if (typeof target !== 'string' || target.length === 0 || target.includes('\0')) {
    return { ok: false, reason: 'empty or invalid path' };
  }
  const resolved = path.resolve(root, target);
  const rel = path.relative(root, resolved);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, reason: 'path escapes sandbox root' };
  }
  // realpath the deepest existing ancestor to defeat symlink escapes.
  let probe = mustExist ? resolved : path.dirname(resolved);
  while (!fs.existsSync(probe) && probe !== root && probe.length > root.length) {
    probe = path.dirname(probe);
  }
  if (fs.existsSync(probe)) {
    const realProbe = fs.realpathSync(probe);
    const realRel = path.relative(root, realProbe);
    if (realRel !== '' && (realRel.startsWith('..') || path.isAbsolute(realRel))) {
      return { ok: false, reason: 'symlinked path escapes sandbox root' };
    }
  }
  return { ok: true, resolved };
}

// Exact-argv command allowlist. Keys are the full argv joined by single spaces.
// npm run <script> is additionally gated by ALLOWED_NPM_SCRIPTS.
export const ALLOWED_COMMANDS: ReadonlySet<string> = new Set([
  'npm test',
  'npm run typecheck',
  'npm run lint',
  'npm run build',
  'npx tsc --noEmit',
  'tsc --noEmit',
  'node --version',
  'npm --version',
]);
const ALLOWED_NPM_SCRIPTS: ReadonlySet<string> = new Set(['test', 'typecheck', 'lint', 'build']);

// Any shell metacharacter → hard reject. We never invoke a shell, but this also
// blocks argv injection attempts before they reach the allowlist check.
const SHELL_METACHARS = /[;&|<>$`(){}\[\]!#*?~\n\r\\'"]/;

export interface CommandCheck {
  ok: boolean;
  argv?: string[];
  reason?: string;
}

export function vetCommand(command: string): CommandCheck {
  if (typeof command !== 'string' || command.trim().length === 0) {
    return { ok: false, reason: 'empty command' };
  }
  if (SHELL_METACHARS.test(command)) {
    return { ok: false, reason: 'shell metacharacters are not permitted' };
  }
  const argv = command.trim().split(/\s+/);
  const norm = argv.join(' ');
  if (ALLOWED_COMMANDS.has(norm)) return { ok: true, argv };
  if (argv[0] === 'npm' && argv[1] === 'run' && argv.length === 3 && ALLOWED_NPM_SCRIPTS.has(argv[2])) {
    return { ok: true, argv };
  }
  return { ok: false, reason: `command not in allowlist: "${norm}"` };
}

/** Minimal child-process env — deliberately excludes every secret. */
export function scrubbedEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: process.env.HOME ?? '/tmp',
    NODE_ENV: process.env.NODE_ENV ?? 'production',
  };
}

// web_fetch: read-only, domain-allowlisted, https-only. Narrow on purpose —
// add hostnames here deliberately rather than opening this up to arbitrary
// URLs. Exact hostname or a subdomain of one of these. Scoped per room
// (RoomScope) so a trading task can't reach coding-only domains and vice
// versa — reviewed and approved before wiring, see
// docs/omnigent-integration-plan.md Phase B.
export const ALLOWED_WEB_DOMAINS_BY_SCOPE: Record<RoomScope, ReadonlySet<string>> = {
  // Unscoped/Control-Room tasks — deliberately the smallest set, not the
  // union of every room's domains.
  all: new Set(['en.wikipedia.org', 'finance.yahoo.com']),
  trading: new Set(['finance.yahoo.com', 'www.sec.gov', 'fred.stlouisfed.org', 'www.federalreserve.gov']),
  coding: new Set(['developer.mozilla.org', 'registry.npmjs.org', 'raw.githubusercontent.com', 'docs.python.org', 'nodejs.org']),
  research: new Set(['en.wikipedia.org', 'arxiv.org']),
  // Content room: deliberately EMPTY. Every external call the content
  // pipeline makes (Pexels, Kokoro, YouTube, Instagram) goes through a
  // declared, env-gated integration in src/lib/content/integrations.ts — not
  // through the sandbox's generic web_fetch. Granting this scope domains
  // would create a second, ungoverned path to the same services. Add here
  // only if a content task ever needs to read a page it cannot reach through
  // a declared integration.
  content: new Set<string>(),
};

// Binary/executable content is never a legitimate result for a text-scrape
// tool — reject anything outside this set rather than trying to enumerate
// what to block.
export const ALLOWED_WEB_CONTENT_TYPES: readonly string[] = ['text/html', 'application/json', 'text/plain'];

const IP_LITERAL = /^(\d{1,3}\.){3}\d{1,3}$|^\[?[0-9a-f:]+\]?$/i;

export interface UrlCheck {
  ok: boolean;
  url?: URL;
  reason?: string;
}

export function vetUrl(raw: string, scope: RoomScope = 'all'): UrlCheck {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, reason: 'empty url' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'only https URLs are permitted' };
  // Allowlist is for named public domains, not IP literals — blocks the
  // simplest SSRF vector outright. DNS-rebinding protection for the *named*
  // domains (a hostname that resolves to a private IP) lives in
  // safe-fetch.ts's isDisallowedIp() check, applied at actual connect time.
  if (IP_LITERAL.test(url.hostname)) return { ok: false, reason: 'IP-literal URLs are not permitted' };
  const host = url.hostname.toLowerCase();
  const domains = ALLOWED_WEB_DOMAINS_BY_SCOPE[scope];
  const allowed = [...domains].some((d) => host === d || host.endsWith(`.${d}`));
  if (!allowed) return { ok: false, reason: `domain not in ${scope} allowlist: ${host}` };
  return { ok: true, url };
}

/**
 * True if `ip` (as returned by dns.lookup) is loopback, link-local, private,
 * CGNAT, documentation/benchmark, multicast, or otherwise non-public — the
 * ranges an SSRF/DNS-rebinding attempt would target. Deliberately fails
 * closed: anything unparseable is treated as disallowed.
 *
 * Not a full IPv6 classifier — it checks the well-known private prefixes by
 * their leading hextet, which is sufficient for this SSRF-guard purpose
 * without pulling in a general IP-range library for one check.
 */
export function isDisallowedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
    const [a, b, c] = parts;
    if (a === 0) return true; // "this network"
    if (a === 10) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF / TEST-NET-1
    if (a === 192 && b === 168) return true; // private
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
    if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
    if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
    if (a >= 224) return true; // multicast (224-239) + reserved (240-255)
    return false;
  }
  if (family === 6) {
    const norm = ip.toLowerCase();
    if (norm === '::1' || norm === '::') return true; // loopback / unspecified
    const v4mapped = norm.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (v4mapped) return isDisallowedIp(v4mapped[1]);
    const firstToken = norm.split(':')[0];
    const first = firstToken === '' ? 0 : parseInt(firstToken, 16);
    if (Number.isNaN(first)) return true;
    if (first >= 0xfe80 && first <= 0xfebf) return true; // link-local fe80::/10
    if (first >= 0xfc00 && first <= 0xfdff) return true; // unique local fc00::/7
    if (first >= 0xff00 && first <= 0xffff) return true; // multicast ff00::/8
    return false;
  }
  return true; // not a recognizable IP — block rather than guess
}

// In-memory sliding-window rate limit, scoped per key (agent id today) so
// one agent's usage can't starve another's — a global counter would let a
// single busy agent lock everyone else out. Defense in depth alongside the
// per-task MAX_STEPS_PER_TASK cap in runner.ts. Resets on process restart;
// that's fine for a soft rate limit, not a security boundary on its own.
const WEB_FETCH_WINDOW_MS = 60_000;
const WEB_FETCH_MAX_PER_WINDOW = 20;
const webFetchTimestampsByKey = new Map<string, number[]>();

export function checkWebFetchRateLimit(key: string): { ok: boolean; reason?: string } {
  const now = Date.now();
  const existing = (webFetchTimestampsByKey.get(key) ?? []).filter((t) => now - t < WEB_FETCH_WINDOW_MS);
  if (existing.length >= WEB_FETCH_MAX_PER_WINDOW) {
    webFetchTimestampsByKey.set(key, existing);
    return { ok: false, reason: `rate limit: ${WEB_FETCH_MAX_PER_WINDOW}/min exceeded for ${key}` };
  }
  existing.push(now);
  webFetchTimestampsByKey.set(key, existing);
  return { ok: true };
}

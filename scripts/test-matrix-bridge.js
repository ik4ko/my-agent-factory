// Browser-free matrix bridge. Mints a valid hermes_session cookie from
// DASHBOARD_PASSWORD (same HMAC scheme as src/lib/auth/session.ts) so requests
// pass middleware WITHOUT weakening the auth gate. Node 18+ (global fetch).
//   node scripts/test-matrix-bridge.js "<objective>"   [--sim]
//   node scripts/test-matrix-bridge.js --probe          (GET the config probe)
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SESSION_COOKIE = 'hermes_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function readEnv(key) {
  if (process.env[key]) return process.env[key];
  const p = path.join(process.cwd(), '.env.local');
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, '');
    }
  }
  return undefined;
}

function mintSession(password) {
  const exp = String(Date.now() + SESSION_TTL_MS);
  const sig = crypto.createHmac('sha256', password).update(exp).digest('hex');
  return `${exp}.${sig}`;
}

(async () => {
  const BASE = process.env.BASE_URL || 'http://localhost:9002';
  const password = readEnv('DASHBOARD_PASSWORD');
  if (!password) { console.error('[bridge] DASHBOARD_PASSWORD missing (env or .env.local)'); process.exit(1); }
  const cookie = `${SESSION_COOKIE}=${mintSession(password)}`;

  // Preflight so failures are loud, not silent.
  try {
    const ping = await fetch(`${BASE}/login`, { redirect: 'manual' });
    console.log(`[bridge] server up — /login → ${ping.status}`);
  } catch (e) {
    console.error(`[bridge] NOT reachable at ${BASE} (${e.message}). Start it: npm run dev`);
    process.exit(1);
  }

  // --probe: GET the auth-gated config probe with the minted cookie.
  if (process.argv.includes('--probe')) {
    const res = await fetch(`${BASE}/api/pipeline/matrix`, { headers: { Cookie: cookie } });
    console.log('[probe] HTTP', res.status);
    console.log(await res.text());
    return;
  }

  const objective = process.argv.find((a, i) => i >= 2 && !a.startsWith('--')) ||
    'analyze semiconductor leveraged ETF exposure under rapid RSI volatility shifting';
  const simulate = process.argv.includes('--sim');

  const res = await fetch(`${BASE}/api/pipeline/matrix`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ objective, simulate }),
  });
  const body = await res.text();
  console.log('[bridge] HTTP', res.status, body);
})();

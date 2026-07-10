// Event-loop watcher — Telegram long-poller, READ-ONLY leg.
//
// Runs as a second supervised process beside server.mjs on the persistent
// wrapper host (see Dockerfile CMD). Scope by design, per the reviewed plan:
//  - Long-polls getUpdates (no webhook — no inbound URL, survives restarts).
//  - EVERY update passes the operator allowlist gate (telegram-gate.mjs)
//    before any other logic; non-operator updates are silently dropped.
//  - Read-only commands only: /ping, /status. NO actions — no staged-order
//    approve/deny, no arm/kill, no writes of any kind. Those are a separate,
//    explicitly-reviewed leg.
//  - Replies go ONLY to the allowlisted operator chat id, never to a chat id
//    taken from the inbound update.
//  - /status reads the app's preflight via the machine-token API lane
//    (Authorization: Bearer MACHINE_API_TOKEN) when APP_BASE_URL is set.
//
// Required env: TELEGRAM_BOT_TOKEN, TELEGRAM_OPERATOR_CHAT_ID (refuses to
// start without both — the allowlist must exist before the poller does).
// Optional env: APP_BASE_URL, MACHINE_API_TOKEN (enables /status),
// TELEGRAM_API_BASE (test override, defaults to https://api.telegram.org).

import { passesOperatorGate, operatorChatId, droppedUpdates } from './telegram-gate.mjs';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim();
const API_BASE = (process.env.TELEGRAM_API_BASE?.trim() || 'https://api.telegram.org').replace(/\/+$/, '');
const APP_BASE_URL = process.env.APP_BASE_URL?.trim()?.replace(/\/+$/, '') || null;
const MACHINE_API_TOKEN = process.env.MACHINE_API_TOKEN?.trim() || null;

const POLL_TIMEOUT_S = 50;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const STARTED_AT = Date.now();

if (!BOT_TOKEN) {
  console.error('[watcher] TELEGRAM_BOT_TOKEN is not set — refusing to start');
  process.exit(1);
}
if (!operatorChatId()) {
  console.error('[watcher] TELEGRAM_OPERATOR_CHAT_ID is not set — refusing to start (allowlist-first)');
  process.exit(1);
}

const tg = (method) => `${API_BASE}/bot${BOT_TOKEN}/${method}`;

/** Send a message to the OPERATOR chat only — the chat id is always the
 *  allowlist value, never anything derived from an inbound update. */
async function notifyOperator(text) {
  try {
    const res = await fetch(tg('sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: operatorChatId(), text }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      console.error(`[watcher] sendMessage failed: ${res.status} ${JSON.stringify(data)?.slice(0, 200)}`);
      return null;
    }
    return data.result; // { message_id, date, chat, text, ... }
  } catch (err) {
    console.error(`[watcher] sendMessage error: ${String(err).slice(0, 200)}`);
    return null;
  }
}

async function statusReadout() {
  if (!APP_BASE_URL || !MACHINE_API_TOKEN) {
    return 'status: app link not configured (APP_BASE_URL / MACHINE_API_TOKEN unset on this host)';
  }
  try {
    const res = await fetch(`${APP_BASE_URL}/api/golive/preflight`, {
      headers: { Authorization: `Bearer ${MACHINE_API_TOKEN}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return `status: preflight fetch failed (${res.status})`;
    const p = await res.json();
    const counts = { pass: 0, warn: 0, fail: 0 };
    for (const c of p.checks ?? []) counts[c.status] = (counts[c.status] ?? 0) + 1;
    const worst = (p.checks ?? []).filter((c) => c.status !== 'pass').slice(0, 3)
      .map((c) => `  • ${c.label}: ${c.status}`).join('\n');
    return [
      `PREFLIGHT ${String(p.overall).toUpperCase()} · ${p.canArm ? 'CAN ARM' : 'CANNOT ARM'}`,
      `${counts.pass} pass · ${counts.warn} warn · ${counts.fail} fail`,
      worst,
    ].filter(Boolean).join('\n');
  } catch (err) {
    return `status: unreachable — ${String(err).slice(0, 120)}`;
  }
}

const HELP = [
  'Read-only commands:',
  '/ping — liveness + uptime',
  '/status — go-live preflight readout',
  'No actions are wired over chat (by design, pending review).',
].join('\n');

/** Read-only command handling. Runs ONLY after the operator gate passed. */
async function handleOperatorMessage(update) {
  const text = (update.message?.text ?? '').trim();
  if (text.startsWith('/ping')) {
    const up = Math.round((Date.now() - STARTED_AT) / 1000);
    await notifyOperator(`pong · up ${up}s · ${droppedUpdates()} non-operator update(s) dropped`);
    return;
  }
  if (text.startsWith('/status')) {
    await notifyOperator(await statusReadout());
    return;
  }
  await notifyOperator(HELP);
}

let running = true;
process.on('SIGTERM', () => { running = false; });
process.on('SIGINT', () => { running = false; });

async function main() {
  console.log(`[watcher] online (read-only) · api=${API_BASE} · app=${APP_BASE_URL ?? 'unlinked'}`);
  const boot = await notifyOperator(
    `watcher online (read-only) · ${new Date().toISOString()} · commands: /ping /status`,
  );
  if (boot) console.log(`[watcher] startup notice delivered · message_id=${boot.message_id} · date=${boot.date}`);

  let offset = 0;
  let backoff = BACKOFF_MIN_MS;

  while (running) {
    try {
      const res = await fetch(tg('getUpdates'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeout: POLL_TIMEOUT_S, offset, allowed_updates: ['message'] }),
        signal: AbortSignal.timeout((POLL_TIMEOUT_S + 15) * 1000),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        // 409 = another poller holds the connection (double deploy) — back off.
        console.error(`[watcher] getUpdates failed: ${res.status} ${JSON.stringify(data)?.slice(0, 160)}`);
        await sleep(backoff);
        backoff = Math.min(BACKOFF_MAX_MS, backoff * 2);
        continue;
      }
      backoff = BACKOFF_MIN_MS;

      for (const update of data.result ?? []) {
        if (typeof update.update_id === 'number') offset = update.update_id + 1;
        // ── ALLOWLIST GATE — first logic, silent drop on failure ──
        if (!passesOperatorGate(update)) continue;
        try {
          await handleOperatorMessage(update);
        } catch (err) {
          console.error(`[watcher] handler error: ${String(err).slice(0, 200)}`);
        }
      }
    } catch (err) {
      console.error(`[watcher] poll error: ${String(err).slice(0, 200)}`);
      await sleep(backoff);
      backoff = Math.min(BACKOFF_MAX_MS, backoff * 2);
    }
  }
  console.log('[watcher] stopped');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

main();

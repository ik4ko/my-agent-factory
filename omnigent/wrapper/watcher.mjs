// Event-loop watcher — Telegram long-poller.
//
// Runs as a second supervised process beside server.mjs on the persistent
// wrapper host (see Dockerfile CMD). Scope by design, per the reviewed plan:
//  - Long-polls getUpdates (no webhook — no inbound URL, survives restarts).
//  - EVERY update passes the operator allowlist gate (telegram-gate.mjs)
//    before any other logic; non-operator updates are silently dropped.
//  - Read-only: /ping, /status.
//  - Decisions: /approve <id>, /deny <id> — routed through the SAME
//    PATCH /api/trading/action-order the dashboard cockpit calls, over the
//    machine-token lane, carrying the Telegram update_id as a dedupe key.
//    NO arm, NO disarm, NO kill switch: those stay PIN-gated and
//    dashboard-only. This host cannot create orders, only decide staged ones.
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
import { parseCallbackData, parseSprintCommand } from './sprint-utils.mjs';
import { startCron } from './cron.mjs';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim();
const API_BASE = (process.env.TELEGRAM_API_BASE?.trim() || 'https://api.telegram.org').replace(/\/+$/, '');
const APP_BASE_URL = process.env.APP_BASE_URL?.trim()?.replace(/\/+$/, '') || null;
const MACHINE_API_TOKEN = process.env.MACHINE_API_TOKEN?.trim() || null;

const POLL_TIMEOUT_S = 50;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const STARTED_AT = Date.now();
// The sprint engine's loopback endpoint (same container — see Dockerfile CMD).
const ENGINE_URL = `http://127.0.0.1:${Number(process.env.ENGINE_PORT ?? 7910)}`;

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
  'Commands:',
  '/ping — liveness + uptime',
  '/status — go-live preflight readout',
  '/approve <order-id> — record APPROVED on a pending staged order',
  '/deny <order-id> — record DENIED on a pending staged order',
  '/sprint <objective> | done: <cond>; <cond> — create a gated CLI sprint task',
  '',
  'Sprint gates arrive as messages with Approve/Abort buttons — no CLI ever launches without that tap.',
  'Arm/disarm and the kill switch are dashboard-only (PIN-gated) — never over chat.',
].join('\n');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Record a human decision on an ALREADY-STAGED order by calling the same
 * PATCH /api/trading/action-order the dashboard cockpit calls, over the
 * machine-token lane. No new privilege path: this cannot arm, disarm, kill,
 * or create an order — only flip a PENDING row to APPROVED/DENIED.
 *
 * The Telegram update_id rides along as `dedupeKey`; the server claims it in
 * system_bus BEFORE touching the order, so an at-least-once redelivery (or a
 * watcher restart mid-handling) can never double-fire the decision.
 */
async function decideOrder(update, action, rawId) {
  if (!APP_BASE_URL || !MACHINE_API_TOKEN) {
    await notifyOperator('cannot act: app link not configured on this host');
    return;
  }
  const orderId = (rawId ?? '').trim();
  if (!UUID_RE.test(orderId)) {
    await notifyOperator(`bad order id — expected a uuid\nusage: /${action === 'APPROVED' ? 'approve' : 'deny'} <order-id>`);
    return;
  }

  let res;
  let body;
  try {
    res = await fetch(`${APP_BASE_URL}/api/trading/action-order`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MACHINE_API_TOKEN}` },
      body: JSON.stringify({
        id: orderId,
        action,
        dedupeKey: String(update.update_id),
        source: 'telegram',
      }),
      signal: AbortSignal.timeout(25_000),
    });
    body = await res.json().catch(() => ({}));
  } catch (err) {
    await notifyOperator(`decision NOT recorded — app unreachable (${String(err).slice(0, 80)})`);
    return;
  }

  if (res.ok) {
    const o = body.order ?? {};
    await notifyOperator(
      `${action === 'APPROVED' ? '✅ APPROVED' : '⛔ DENIED'}\n` +
        `${o.underlying ?? '?'} ${o.option_type ?? ''} ${o.strike ?? ''} @ ${o.limit_price ?? '?'}\n` +
        `size $${Math.round(Number(o.calculated_position_size_usd ?? 0)).toLocaleString()} · ${o.source ?? '?'}\n` +
        `decision recorded — no broker dispatch exists`,
    );
    return;
  }
  if (res.status === 409 && body.deduped) {
    await notifyOperator('duplicate delivery — this command was already processed (no change)');
    return;
  }
  if (res.status === 409) {
    // Explicit, never a silent drop: the id isn't a pending order.
    await notifyOperator(`no action taken — order is not pending (not found, or already approved/denied)\nid: ${orderId}`);
    return;
  }
  await notifyOperator(`decision NOT recorded — ${res.status}: ${String(body.error ?? '').slice(0, 120)}`);
}

/** POST to the sprint engine on loopback. Returns {ok, message} shaped for
 *  operator display; network failure is reported, never swallowed. */
async function callEngine(path, payload) {
  try {
    const res = await fetch(`${ENGINE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok && body.ok === true, message: body.message ?? `engine replied ${res.status}` };
  } catch (err) {
    return { ok: false, message: `sprint engine unreachable — ${String(err).slice(0, 100)}` };
  }
}

async function answerCallback(callbackQueryId, text) {
  try {
    await fetch(tg('answerCallbackQuery'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text: text.slice(0, 190) }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    /* the toast is best-effort; the notifyOperator message is the record */
  }
}

/**
 * Sprint-gate button taps. Runs only after the outer allowlist gate passed
 * (chatIdOf covers callback_query.message.chat) — and re-checks the TAPPING
 * USER's id here, defense in depth per the reviewed plan: the chat check
 * proves where the message lives, this proves who pressed the button.
 * The engine does the update_id dedupe claim + the CAS state check and gives
 * stale callbacks an explicit rejection ("already decided"), never a silent
 * drop — mirroring the proven action-order pattern.
 */
async function handleCallbackQuery(update) {
  const cb = update.callback_query;
  if (String(cb.from?.id ?? '') !== operatorChatId()) return; // silent drop, same policy as the outer gate
  const parsed = parseCallbackData(cb.data);
  if (!parsed) {
    await answerCallback(cb.id, 'unrecognized button');
    return;
  }
  const result = await callEngine('/gate-decision', {
    shortCode: parsed.shortCode,
    gateId: parsed.gateId,
    decision: parsed.decision,
    dedupeKey: String(update.update_id),
    decidedBy: String(cb.from.id),
  });
  await answerCallback(cb.id, result.message);
  await notifyOperator(result.message);
}

/** Command handling. Runs ONLY after the operator allowlist gate passed. */
async function handleOperatorMessage(update) {
  const text = (update.message?.text ?? '').trim();
  // tolerate /cmd@botname and extra whitespace
  const [rawCmd, ...rest] = text.split(/\s+/);
  const cmd = rawCmd.split('@')[0].toLowerCase();

  if (cmd === '/ping') {
    const up = Math.round((Date.now() - STARTED_AT) / 1000);
    await notifyOperator(`pong · up ${up}s · ${droppedUpdates()} non-operator update(s) dropped`);
    return;
  }
  if (cmd === '/status') {
    await notifyOperator(await statusReadout());
    return;
  }
  if (cmd === '/approve') {
    await decideOrder(update, 'APPROVED', rest[0]);
    return;
  }
  if (cmd === '/deny') {
    await decideOrder(update, 'DENIED', rest[0]);
    return;
  }
  if (cmd === '/sprint') {
    const parsed = parseSprintCommand(text);
    if (!parsed) {
      await notifyOperator(
        'usage: /sprint <objective> | done: <condition>; <condition>\n' +
          'The definition of done is required and human-authored — a sprint without a checkable goal is exactly what the gate design forbids.',
      );
      return;
    }
    const result = await callEngine('/task', {
      objective: parsed.objective,
      definitionOfDone: parsed.definitionOfDone,
    });
    await notifyOperator(result.message);
    return;
  }
  await notifyOperator(HELP);
}

let running = true;
process.on('SIGTERM', () => { running = false; });
process.on('SIGINT', () => { running = false; });

async function main() {
  console.log(`[watcher] online · api=${API_BASE} · app=${APP_BASE_URL ?? 'unlinked'}`);
  const boot = await notifyOperator(
    `watcher online · ${new Date().toISOString()} · commands: /ping /status /approve /deny`,
  );
  if (boot) console.log(`[watcher] startup notice delivered · message_id=${boot.message_id} · date=${boot.date}`);

  // Notify-only cron schedules share this process (one supervised loop) and
  // this sender (which only ever targets the allowlisted operator chat).
  const stopCron = startCron({ notifyOperator });

  let offset = 0;
  let backoff = BACKOFF_MIN_MS;

  while (running) {
    try {
      const res = await fetch(tg('getUpdates'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // callback_query must be listed or Telegram never delivers button
        // taps at all (allowed_updates is an opt-in filter).
        body: JSON.stringify({ timeout: POLL_TIMEOUT_S, offset, allowed_updates: ['message', 'callback_query'] }),
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
          if (update.callback_query) await handleCallbackQuery(update);
          else if (update.message) await handleOperatorMessage(update);
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
  stopCron();
  console.log('[watcher] stopped');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

main();

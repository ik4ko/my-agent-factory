// Cron watchers — NOTIFY-ONLY, on the watcher's own supervised process.
//
// Two schedules, both of which can do exactly one thing: send a message to the
// allowlisted operator chat. They cannot act on an order, cannot arm/disarm,
// cannot reach the kill switch. They add NO command surface and NO API route.
//
//  1. Market-hours heartbeat — one ping per clock hour while the NYSE regular
//     session is open; completely silent outside it (nights, weekends).
//  2. Staged-order pending nudge — if an order has sat PENDING longer than
//     NUDGE_AFTER_MIN, say so, then re-remind at most every NUDGE_REPEAT_MIN
//     while it is still pending.
//
// READ PATH: pending orders are read straight from PostgREST with the PUBLIC
// anon key — the same key every browser already ships, constrained by the
// `staged_orders_read` RLS policy (select-only). No service-role key ever
// touches this host, and no new route was added to the app.
//
// DEDUPE: these watchers never write to system_bus, so the update_id claim
// discipline does not apply. Nudge suppression is in-process; a restart can
// therefore re-send one nudge for a still-pending order. That is a duplicate
// NOTIFICATION, never a duplicate action — the approve/deny path remains
// DB-claim protected.

import { isMarketOpen, etClock } from './market-hours.mjs';

const TICK_MS = 60_000; // scheduler resolution
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_INTERVAL_MS ?? 3_600_000); // 1h
const NUDGE_AFTER_MIN = Number(process.env.NUDGE_AFTER_MIN ?? 15);
const NUDGE_REPEAT_MIN = Number(process.env.NUDGE_REPEAT_MIN ?? 60);

const SUPABASE_URL = process.env.SUPABASE_URL?.trim()?.replace(/\/+$/, '') || null;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY?.trim() || null;

/** Pending staged orders, oldest first. Read-only, anon key, RLS-constrained. */
async function fetchPendingOrders() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null; // unconfigured → nudge disabled
  const url =
    `${SUPABASE_URL}/rest/v1/staged_orders` +
    `?select=id,underlying,option_type,strike,limit_price,calculated_position_size_usd,created_at` +
    `&human_approval_status=eq.PENDING&order=created_at.asc`;
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`staged_orders read ${res.status}`);
  return res.json();
}

const minutesSince = (iso) => (Date.now() - new Date(iso).getTime()) / 60_000;

/**
 * Start both schedules. `notifyOperator` is the watcher's sender — it always
 * targets the allowlisted chat id, never one derived from an inbound update.
 * Returns a stop() for clean shutdown.
 */
export function startCron({ notifyOperator, log = console.log }) {
  let lastHeartbeatAt = 0;
  /** orderId → last time we nudged about it (ms epoch). */
  const nudgedAt = new Map();
  let ticking = false;

  const heartbeat = async () => {
    if (!isMarketOpen()) return; // silent outside the regular session
    if (Date.now() - lastHeartbeatAt < HEARTBEAT_MS) return;
    lastHeartbeatAt = Date.now();
    const sent = await notifyOperator(`♥ heartbeat · NYSE open · ${etClock()} · watcher healthy`);
    log(`[cron] heartbeat fired at ${etClock()}${sent ? ` · message_id=${sent.message_id}` : ' · send FAILED'}`);
  };

  const nudge = async () => {
    let pending;
    try {
      pending = await fetchPendingOrders();
    } catch (err) {
      log(`[cron] pending read failed: ${String(err).slice(0, 120)}`);
      return;
    }
    if (pending === null) return; // not configured

    const live = new Set(pending.map((o) => o.id));
    for (const id of nudgedAt.keys()) if (!live.has(id)) nudgedAt.delete(id); // decided → forget

    const due = pending.filter((o) => {
      if (minutesSince(o.created_at) < NUDGE_AFTER_MIN) return false;
      const last = nudgedAt.get(o.id);
      return last === undefined || (Date.now() - last) / 60_000 >= NUDGE_REPEAT_MIN;
    });
    if (due.length === 0) return;

    const lines = due.map((o) => {
      const age = Math.floor(minutesSince(o.created_at));
      return (
        `• ${o.underlying} ${o.option_type} ${o.strike} @ ${o.limit_price} ` +
        `· $${Math.round(Number(o.calculated_position_size_usd)).toLocaleString()} · pending ${age}m\n` +
        `  /approve ${o.id}\n  /deny ${o.id}`
      );
    });
    const sent = await notifyOperator(
      `⏳ ${due.length} staged order${due.length > 1 ? 's' : ''} awaiting your decision ` +
        `(> ${NUDGE_AFTER_MIN}m)\n\n${lines.join('\n')}`,
    );
    if (sent) for (const o of due) nudgedAt.set(o.id, Date.now());
    log(`[cron] nudge fired for ${due.length} order(s)${sent ? '' : ' · send FAILED'}`);
  };

  const tick = async () => {
    if (ticking) return; // never overlap a slow tick
    ticking = true;
    try {
      await heartbeat();
      await nudge();
    } catch (err) {
      log(`[cron] tick error: ${String(err).slice(0, 160)}`);
    } finally {
      ticking = false;
    }
  };

  log(
    `[cron] armed · heartbeat every ${Math.round(HEARTBEAT_MS / 60000)}m while NYSE open · ` +
      `nudge after ${NUDGE_AFTER_MIN}m, repeat ${NUDGE_REPEAT_MIN}m · ` +
      `pending-read ${SUPABASE_URL ? 'enabled' : 'DISABLED (supabase env unset)'}`,
  );
  void tick(); // evaluate immediately on boot
  const handle = setInterval(() => void tick(), TICK_MS);
  handle.unref?.();
  return () => clearInterval(handle);
}

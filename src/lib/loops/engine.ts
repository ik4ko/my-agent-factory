// Loop Engine — persistent, concurrent, cadence + event driven objectives.
//
// A "loop" is a standing objective (loops table) the system re-evaluates
// either on a fixed cadence (cadence_seconds) or when a matching event lands
// on the bus (events table). This module is imported by both the always-on
// worker (scripts/loop-worker.mts) and the HTTP cron-heartbeat backup
// (/api/loops/tick) — it owns no process state of its own beyond WORKER_ID.
//
// Safety note: 'trade' kind loops route every decision through the risk gate
// (src/lib/execution/risk.ts) and selectAdapter() (src/lib/execution/select-
// adapter.ts) before anything is recorded as more than a decision. While
// selectAdapter() always resolves to DryRunAdapter. The durable arm state only
// enables or pauses paper execution; it cannot select a live broker.
import { randomUUID } from 'crypto';
import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { AgentRegistry } from '@/lib/agents/registry';
import { checkRisk } from '@/lib/execution/risk';
import { selectAdapter } from '@/lib/execution/select-adapter';
import { extractOrderIntent } from '@/lib/execution/order-intent';
import { notify } from '@/lib/comms/transport';
import type { LoopRow, LoopTrigger, EventRow, EventSeverity } from '@/lib/types/database.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

// One id per worker process — identifies who holds each loop's lock, so a
// crashed holder's locks are distinguishable from a live one's in the logs.
const WORKER_ID = `worker:${randomUUID().slice(0, 8)}`;

const STALE_LOCK_MINUTES = 3;
const CLAIM_BATCH = 20;
const DEFAULT_CONCURRENCY = 8;

const SEVERITY_RANK: Record<EventSeverity, number> = { low: 0, med: 1, high: 2, critical: 3 };

function severityMeets(actual: EventSeverity | null, min?: EventSeverity): boolean {
  if (!min) return true;
  if (!actual) return false;
  return SEVERITY_RANK[actual] >= SEVERITY_RANK[min];
}

function triggerMatches(trigger: LoopTrigger, event: EventRow): boolean {
  if (trigger.type !== event.type) return false;
  if (trigger.symbol && trigger.symbol !== event.symbol) return false;
  if (!severityMeets(event.severity, trigger.minSeverity)) return false;
  return true;
}

/** Release stale locks left behind by a worker that died mid-run. */
async function clearStaleLoopLocks(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_LOCK_MINUTES * 60_000).toISOString();
  const { data, error } = await db()
    .from('loops')
    .update({ lock_owner: null, lock_at: null })
    .lt('lock_at', cutoff)
    .not('lock_owner', 'is', null)
    .select('id');
  if (error) {
    await hermesLog('error', `[LOOPS] stale-lock clear failed — ${error.message.replace(/\s+/g, ' ').slice(0, 160)}`);
    return 0;
  }
  return (data ?? []).length;
}

/** Optimistic claim — wins only if no other worker holds the lock right now. */
async function claimLoop(loopId: string): Promise<boolean> {
  const { data, error } = await db()
    .from('loops')
    .update({ lock_owner: WORKER_ID, lock_at: new Date().toISOString() })
    .eq('id', loopId)
    .is('lock_owner', null)
    .select('id')
    .maybeSingle();
  if (error) return false;
  return Boolean(data);
}

async function releaseLoop(loop: LoopRow, ranAt: Date): Promise<void> {
  const nextTick = loop.cadence_seconds ? new Date(ranAt.getTime() + loop.cadence_seconds * 1000).toISOString() : null;
  await db()
    .from('loops')
    .update({ lock_owner: null, lock_at: null, last_tick_at: ranAt.toISOString(), next_tick_at: nextTick })
    .eq('id', loop.id);
}

function resolveBrain(name: string) {
  switch (name.toLowerCase()) {
    case 'codex':
    case 'scout':
    case 'research':
    case 'browser':
      return AgentRegistry.CODEX;
    case 'hermes':
    case 'grok':
    case 'gemini':
    case 'nemotron':
      return AgentRegistry.CLAUDE;
    case 'claude':
    default:
      return AgentRegistry.CLAUDE;
  }
}

/** Surfaces the actual news content (headline/sentiment/rationale) to the
 *  brain, not just type/symbol/severity — a trigger note that only says
 *  "high-severity news event on NVDA" gives the model nothing to reason
 *  about and it will (correctly, but uselessly) hold every time. */
function formatTriggerNote(trigger: EventRow | { type: 'manual' } | null): string {
  if (!trigger || !('symbol' in trigger)) return '';
  const payload = (trigger.payload ?? {}) as Record<string, unknown>;
  const base = `Triggered by ${trigger.type} event on ${trigger.symbol ?? 'n/a'} (severity ${trigger.severity ?? 'n/a'})`;

  // Options-flow signal — surface the deterministic scanner's real context
  // (score/contracts/premium/DTE/side/block-sweep/hedge + validator brief) so
  // the strategy brain has something to reason about instead of holding blind.
  // The loop can only place EQUITY orders (see order-intent.ts), so this is
  // framed as a directional SIGNAL, never an option order.
  if (payload.kind === 'options_flow') {
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const labels = Array.isArray(payload.labels) ? payload.labels.filter((l): l is string => typeof l === 'string') : [];
    const contracts = num(payload.contracts);
    const premium = num(payload.premiumUsd);
    const dte = num(payload.dte);
    const parts = [base, `options-flow score ${num(payload.score) ?? '?'}/100`];
    if (str(payload.optionType)) parts.push(String(payload.optionType));
    if (contracts !== null) parts.push(`${contracts.toLocaleString()} contracts`);
    if (premium !== null) parts.push(`~$${Math.round(premium).toLocaleString()} premium`);
    if (str(payload.expiration)) parts.push(`exp ${payload.expiration}${dte !== null ? ` (${dte}DTE)` : ''}`);
    if (str(payload.tradeType)) parts.push(String(payload.tradeType).toLowerCase());
    if (labels.length) parts.push(`labels: ${labels.join(', ')}`);
    const brief = str(payload.validatorBrief) ?? str(payload.reason);
    const hedge = labels.some((l) => /hedge/i.test(l)) ? ' Consider whether this is a HEDGE, not a directional bet.' : '';
    return (
      ` ${parts.join(' — ')}.` +
      ` This is a directional options-flow SIGNAL informing an EQUITY decision, not an option order.${hedge}` +
      (brief ? ` Validator: ${brief}` : '') +
      ` Actively try to REJECT this trade (liquidity, spread, trend, news/earnings, hedge risk) before emitting any ORDER_INTENT.`
    );
  }

  const news = payload as { headline?: string; sentiment?: number; rationale?: string };
  const parts = [base];
  if (news.headline) parts.push(`headline: "${news.headline}"`);
  if (typeof news.sentiment === 'number') parts.push(`sentiment: ${news.sentiment.toFixed(2)}`);
  if (news.rationale) parts.push(`rationale: ${news.rationale}`);
  return ` ${parts.join(' — ')}.`;
}

/** Run a bounded-concurrency pool over a queue of items (shift-based lanes,
 *  same pattern as agents/orchestrator.ts executeDispatches). */
async function runPooled<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const lanes = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      await fn(item);
    }
  });
  await Promise.all(lanes);
}

/**
 * Trade-kind loop body: ask the brain for a decision, extract an
 * ORDER_INTENT if it gave one, run it through the risk gate, then place it
 * via whichever adapter selectAdapter() resolves to. Writes the loop_runs
 * row itself (caller passes the already-opened runId) since the shape of
 * `actions`/`result` differs from the generic decision-only branch.
 */
async function runTradeLoop(loop: LoopRow, trigger: EventRow | { type: 'manual' } | null, runId: string): Promise<void> {
  const brain = resolveBrain(loop.brain);
  const triggerNote = formatTriggerNote(trigger);
  const thought = await brain.think({
    system:
      `You are a standing TRADE loop evaluator. ` +
      `If and only if you want to place an order RIGHT NOW, your reply MUST begin with exactly one machine-readable line, ` +
      `BEFORE any explanation (verbose reasoning after this line is fine and will not affect parsing, but it must never come first):\n` +
      `ORDER_INTENT: {"symbol":"NVDA","side":"buy","qty":1,"type":"market","reason":"..."}\n` +
      `Omit that line entirely if you are only observing/waiting this cycle, and instead explain your read in a few sentences.`,
    prompt: `${loop.objective}${triggerNote}`,
    maxTokens: 600,
    ledger: { detail: `loop:${loop.kind}:${loop.id}` },
  });
  const decision = { type: 'brain_decision', text: thought.text, model: thought.model, provider: thought.provider };
  await hermesLog('info', `[LOOP] ${loop.name} (trade) decision: ${thought.text.slice(0, 160)}`);

  const raw = extractOrderIntent(thought.text);
  if (!raw) {
    await db()
      .from('loop_runs')
      .update({ decision, actions: [], result: { executed: false, note: 'no order intent this cycle' }, status: 'completed', finished_at: new Date().toISOString() })
      .eq('id', runId);
    return;
  }

  // One loop run can emit at most one order. Its durable run UUID is therefore
  // the stable client-order key across network retries and worker recovery.
  const intent = { ...raw, loopId: loop.id, clientOrderId: runId };
  const adapter = await selectAdapter();
  const gate = await checkRisk(intent, loop.config, adapter);

  if (!gate.allowed) {
    await db().from('orders').insert({
      client_order_id: intent.clientOrderId,
      loop_id: loop.id,
      symbol: intent.symbol,
      side: intent.side,
      qty: intent.qty ?? null,
      notional: intent.notional ?? null,
      type: intent.type,
      limit_price: intent.limitPrice ?? null,
      status: 'risk_blocked',
      reason: gate.reason,
    });
    await hermesLog('warn', `[RISK] blocked ${intent.side} ${intent.symbol} for ${loop.name}: ${gate.reason}`);
    await db()
      .from('loop_runs')
      .update({
        decision,
        actions: [{ type: 'order_blocked', intent, reason: gate.reason }],
        result: { executed: false, note: 'risk gate blocked' },
        status: 'completed',
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId);
    return;
  }

  const result = await adapter.placeOrder(intent);
  await db().from('orders').upsert({
    client_order_id: intent.clientOrderId,
    loop_id: loop.id,
    symbol: intent.symbol,
    side: intent.side,
    qty: intent.qty ?? null,
    notional: intent.notional ?? null,
    type: intent.type,
    limit_price: intent.limitPrice ?? null,
    status: result.status,
    fill_price: result.fillPrice ?? null,
    reason: result.reason ?? null,
  }, { onConflict: 'client_order_id' });
  await hermesLog(
    result.status === 'dry_run' ? 'info' : 'success',
    `[ORDER] ${loop.name} ${intent.side} ${intent.symbol} via ${adapter.name} → ${result.status}${result.fillPrice ? ` @ $${result.fillPrice}` : ''}`
  );
  if (result.status !== 'dry_run') {
    await notify(`[${loop.name}] ${intent.side.toUpperCase()} ${intent.symbol} → ${result.status}${result.fillPrice ? ` @ $${result.fillPrice}` : ''}. ${intent.reason}`);
  }
  await db()
    .from('loop_runs')
    .update({
      decision,
      actions: [{ type: 'order', intent, adapter: adapter.name }],
      result: { executed: true, status: result.status },
      status: 'completed',
      finished_at: new Date().toISOString(),
    })
    .eq('id', runId);
}

/**
 * content_sync loop body — refresh every connected channel link on cadence.
 *
 * Deliberately thin: it calls the SAME refreshLink the manual Refresh button
 * uses, so automated and manual syncs cannot drift apart. No brain, no tokens,
 * no second orchestrator.
 *
 * Quota (verified 2026-07-26): 3 units per channel per refresh — channels.list
 * 1 + playlistItems.list 1 + videos.list 1 (ids batched 50/call). Three
 * channels hourly is ~216 units/day against a 10,000/day allowance, ~2.2%.
 * Comments are never fetched here; they stay click-through only.
 *
 * `config.channelSlugs` (optional string[]) narrows which channels sync; absent
 * means all of them. Per-link failures are recorded and do NOT abort the
 * sweep — one channel hitting a quota wall must not stop the others.
 */
async function runContentSyncLoop(loop: LoopRow, runId: string): Promise<void> {
  const { listLinks, refreshLink } = await import('@/lib/content/channel-links');
  const { isYoutubeDataConfigured } = await import('@/lib/content/youtube-data');

  // Missing key is a configuration state, not a failure: record it and leave
  // without burning the run or spamming the error log every hour.
  if (!isYoutubeDataConfigured()) {
    await db()
      .from('loop_runs')
      .update({
        decision: { type: 'content_sync', skipped: 'YOUTUBE_DATA_API_KEY not configured' },
        actions: [],
        result: { executed: false, links: 0 },
        status: 'completed',
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId);
    return;
  }

  const wanted = Array.isArray(loop.config?.channelSlugs)
    ? (loop.config.channelSlugs as unknown[]).filter((s): s is string => typeof s === 'string')
    : null;

  const allLinks = await listLinks();
  // channelSlugs filters by the CHANNEL's slug, so resolve through the
  // channels table rather than assuming the link carries it.
  let links = allLinks;
  if (wanted && wanted.length > 0) {
    const { data: channels } = await db()
      .from('content_channels')
      .select('id, slug')
      .in('slug', wanted);
    const ids = new Set(((channels ?? []) as Array<{ id: string }>).map((c) => c.id));
    links = allLinks.filter((l) => ids.has(l.channel_id));
  }

  const actions: Array<{ linkId: string; ok: boolean; units: number; videos?: number; error?: string }> = [];
  let unitsSpent = 0;
  for (const link of links) {
    const result = await refreshLink(link.id);
    unitsSpent += result.quota.units;
    actions.push({
      linkId: link.id,
      ok: result.ok,
      units: result.quota.units,
      ...(result.videoCount !== undefined ? { videos: result.videoCount } : {}),
      ...(result.error ? { error: result.error } : {}),
    });
  }

  const failed = actions.filter((a) => !a.ok).length;
  await hermesLog(
    failed > 0 ? 'warn' : 'info',
    `[LOOP] ${loop.name} synced ${actions.length - failed}/${actions.length} channels · ${unitsSpent} quota units`,
  );
  await db()
    .from('loop_runs')
    .update({
      decision: { type: 'content_sync', links: links.length, scope: wanted ?? 'all' },
      actions,
      // A partial sweep is still a completed run — per-link errors live in
      // actions[] and on the link row, where the room already surfaces them.
      result: { executed: true, synced: actions.length - failed, failed, quotaUnits: unitsSpent },
      status: 'completed',
      finished_at: new Date().toISOString(),
    })
    .eq('id', runId);
}

/**
 * Evaluate one loop, either on cadence (trigger=null) or in reaction to a
 * bus event. Writes a full audit row to loop_runs and never throws — a
 * failing loop must not take down the worker or other loops.
 */
export async function runLoop(loop: LoopRow, trigger: EventRow | { type: 'manual' } | null): Promise<void> {
  const startedAt = new Date();
  const { data: runRow, error: runErr } = await db()
    .from('loop_runs')
    .insert({ loop_id: loop.id, trigger: trigger ?? null, status: 'running', started_at: startedAt.toISOString() })
    .select('id')
    .single();
  if (runErr) {
    await hermesLog('error', `[LOOP] ${loop.name}: could not open loop_run — ${runErr.message.replace(/\s+/g, ' ').slice(0, 160)}`);
    return;
  }
  const runId = (runRow as { id: string }).id;

  try {
    if (loop.kind === 'monitor') {
      // Cheap heartbeat — proves the tick/lock/reschedule path end-to-end
      // without spending any tokens.
      const decision = { type: 'heartbeat', objective: loop.objective };
      await hermesLog('info', `[LOOP] ${loop.name} heartbeat — ${loop.objective}`);
      await db()
        .from('loop_runs')
        .update({ decision, actions: [], result: { ok: true }, status: 'completed', finished_at: new Date().toISOString() })
        .eq('id', runId);
    } else if (loop.kind === 'trade') {
      await runTradeLoop(loop, trigger, runId);
    } else if (loop.kind === 'content_sync') {
      await runContentSyncLoop(loop, runId);
    } else {
      // research/build/personal — ask the loop's brain for a decision. No
      // execution path for these kinds; this records what the brain would
      // do without acting on it.
      const brain = resolveBrain(loop.brain);
      const triggerNote = formatTriggerNote(trigger);
      const thought = await brain.think({
        system: `You are a standing-loop evaluator for kind="${loop.kind}". Reply with a short, concrete next-step decision for this objective. You do not have execution access yet — describe what you would do.`,
        prompt: `${loop.objective}${triggerNote}`,
        maxTokens: 400,
        ledger: { detail: `loop:${loop.kind}:${loop.id}` },
      });
      const decision = { type: 'brain_decision', text: thought.text, model: thought.model, provider: thought.provider };
      await hermesLog('info', `[LOOP] ${loop.name} (${loop.kind}) decision: ${thought.text.slice(0, 160)}`);
      await db()
        .from('loop_runs')
        .update({
          decision,
          actions: [],
          result: { executed: false, note: 'no execution path for this loop kind' },
          status: 'completed',
          finished_at: new Date().toISOString(),
        })
        .eq('id', runId);
    }
  } catch (err) {
    const line = String(err).replace(/\s+/g, ' ').slice(0, 200);
    await hermesLog('error', `[LOOP] ${loop.name} failed: ${line}`);
    await db().from('loop_runs').update({ status: 'failed', error: line, finished_at: new Date().toISOString() }).eq('id', runId);
  } finally {
    await releaseLoop(loop, startedAt);
  }
}

export interface TickResult {
  cleared: number;
  scanned: number;
  ran: number;
}

/** Cadence sweep — claim armed loops due for a tick and run them concurrently. */
export async function tick(concurrency = DEFAULT_CONCURRENCY): Promise<TickResult> {
  const cleared = await clearStaleLoopLocks();

  const { data, error } = await db()
    .from('loops')
    .select('*')
    .eq('status', 'armed')
    .is('lock_owner', null)
    .or(`next_tick_at.is.null,next_tick_at.lte.${new Date().toISOString()}`)
    .limit(CLAIM_BATCH);
  if (error) {
    await hermesLog('error', `[LOOPS] tick scan failed — ${error.message.replace(/\s+/g, ' ').slice(0, 160)}`);
    return { cleared, scanned: 0, ran: 0 };
  }

  const due = (data ?? []) as LoopRow[];
  const claimed: LoopRow[] = [];
  for (const loop of due) {
    if (await claimLoop(loop.id)) claimed.push(loop);
  }

  await runPooled(claimed, concurrency, (loop) => runLoop(loop, null));
  return { cleared, scanned: due.length, ran: claimed.length };
}

export interface DispatchResult {
  events: number;
  matched: number;
}

/** Event sweep — match unconsumed bus events against every armed loop's
 *  triggers and immediately run the matches, out of cadence. */
export async function dispatchEvents(concurrency = DEFAULT_CONCURRENCY): Promise<DispatchResult> {
  const { data: events, error: evErr } = await db()
    .from('events')
    .select('*')
    .eq('consumed', false)
    .order('created_at', { ascending: true })
    .limit(CLAIM_BATCH);
  if (evErr) {
    await hermesLog('error', `[LOOPS] event scan failed — ${evErr.message.replace(/\s+/g, ' ').slice(0, 160)}`);
    return { events: 0, matched: 0 };
  }
  const pending = (events ?? []) as EventRow[];
  if (pending.length === 0) return { events: 0, matched: 0 };

  const { data: loops, error: loopErr } = await db().from('loops').select('*').eq('status', 'armed').is('lock_owner', null);
  if (loopErr) {
    await hermesLog('error', `[LOOPS] armed-loop scan failed — ${loopErr.message.replace(/\s+/g, ' ').slice(0, 160)}`);
    return { events: pending.length, matched: 0 };
  }
  const armed = (loops ?? []) as LoopRow[];

  const runs: Array<{ loop: LoopRow; event: EventRow }> = [];
  for (const event of pending) {
    for (const loop of armed) {
      const triggers = Array.isArray(loop.triggers) ? (loop.triggers as LoopTrigger[]) : [];
      if (triggers.some((t) => triggerMatches(t, event))) runs.push({ loop, event });
    }
    await db().from('events').update({ consumed: true }).eq('id', event.id);
  }

  const claimed: Array<{ loop: LoopRow; event: EventRow }> = [];
  for (const r of runs) {
    if (await claimLoop(r.loop.id)) claimed.push(r);
  }

  await runPooled(claimed, concurrency, (r) => runLoop(r.loop, r.event));
  return { events: pending.length, matched: claimed.length };
}

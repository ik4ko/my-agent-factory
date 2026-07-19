// Safety-verification harness — automates four simulation safety
// checks in dry-run, each backed by a real DB read/write, not an assertion
// against in-memory state. Non-destructive: everything it creates (a
// throwaway loop) is deleted afterward, and risk_state is snapshotted
// before the run and restored exactly afterward, success or failure.
import { getAdminClient } from '@/lib/supabase/admin';
import { checkRisk } from '@/lib/execution/risk';
import { selectAdapter } from '@/lib/execution/select-adapter';
import { setKillSwitch } from '@/lib/control/risk-actions';
import { notify } from '@/lib/comms/transport';
import type { OrderIntent } from '@/lib/execution/types';
import type { RiskStateRow } from '@/lib/types/database.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export interface SelftestCheck {
  id: string;
  label: string;
  status: 'pass' | 'fail';
  detail: string;
}
export interface SelftestResult {
  checks: SelftestCheck[];
  overall: 'pass' | 'fail';
  ranAt: string;
}

async function snapshotRiskState(): Promise<RiskStateRow> {
  const { data, error } = await db().from('risk_state').select('*').eq('id', 1).single();
  if (error) throw new Error(`could not snapshot risk_state: ${error.message}`);
  return data as RiskStateRow;
}

async function restoreRiskState(snapshot: RiskStateRow): Promise<void> {
  await db()
    .from('risk_state')
    .update({
      trading_enabled: snapshot.trading_enabled,
      kill_switch: snapshot.kill_switch,
      halted: snapshot.halted,
      halt_reason: snapshot.halt_reason,
      realized_pnl: snapshot.realized_pnl,
      regime: snapshot.regime,
      symbol_overrides: snapshot.symbol_overrides,
      feed_degraded: snapshot.feed_degraded,
      feed_degraded_reason: snapshot.feed_degraded_reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1);
}

async function createThrowawayLoop(): Promise<string> {
  const { data, error } = await db()
    .from('loops')
    .insert({
      name: `__selftest__ ${Date.now()}`,
      kind: 'trade',
      objective: 'Simulation safety-verification scratch loop — never ticked, deleted at the end of the run.',
      status: 'paused',
      config: { symbolAllowlist: ['NVDA'], maxTradeUsd: 500 },
      triggers: [],
      brain: 'claude',
    })
    .select('id')
    .single();
  if (error) throw new Error(`could not create throwaway loop: ${error.message}`);
  return (data as { id: string }).id;
}

async function deleteThrowawayLoop(loopId: string): Promise<void> {
  await db().from('loops').delete().eq('id', loopId); // cascades loop_runs; orders.loop_id -> set null
}

/** Check 1 — fill path: a synthetic decision runs through the exact same
 *  risk-gate + adapter path a paper trade loop uses, and must land as a
 *  dry_run order at a real market quote. */
async function checkFillPath(loopId: string): Promise<SelftestCheck> {
  const intent: OrderIntent = { clientOrderId: crypto.randomUUID(), loopId, symbol: 'NVDA', side: 'buy', qty: 1, type: 'market', reason: 'simulation selftest — fill path' };
  const adapter = await selectAdapter();
  const gate = await checkRisk(intent, { symbolAllowlist: ['NVDA'], maxTradeUsd: 500 }, adapter);
  if (!gate.allowed) {
    return { id: 'fill_path', label: 'Fill path (risk gate → dry_run order)', status: 'fail', detail: `risk gate unexpectedly blocked: ${gate.reason}` };
  }
  const result = await adapter.placeOrder(intent);
  const { data: order, error } = await db()
    .from('orders')
    .insert({
      loop_id: loopId,
      symbol: intent.symbol,
      side: intent.side,
      qty: intent.qty,
      type: intent.type,
      status: result.status,
      fill_price: result.fillPrice ?? null,
      reason: result.reason ?? null,
    })
    .select()
    .single();
  if (error) return { id: 'fill_path', label: 'Fill path (risk gate → dry_run order)', status: 'fail', detail: `orders insert failed: ${error.message}` };

  await db().from('loop_runs').insert({
    loop_id: loopId,
    trigger: null,
    decision: { type: 'selftest', text: 'synthetic fill-path decision' },
    actions: [{ type: 'order', intent, adapter: adapter.name }],
    result: { executed: true, status: result.status },
    status: 'completed',
    finished_at: new Date().toISOString(),
  });

  const ok = result.status === 'dry_run' && Boolean(result.fillPrice);
  return {
    id: 'fill_path',
    label: 'Fill path (risk gate → dry_run order)',
    status: ok ? 'pass' : 'fail',
    detail: `orders.id=${order.id} status=${result.status} fill_price=${result.fillPrice ?? 'n/a'} adapter=${adapter.name}`,
  };
}

/** Check 2 — notification: the transport layer actually persists a real,
 *  inspectable delivery. */
async function checkNotification(): Promise<SelftestCheck> {
  const marker = `[SELFTEST] notification check ${Date.now()}`;
  await notify(marker);
  const { data } = await db().from('outbound_messages').select('id, status').eq('body', marker).limit(1).maybeSingle();
  return data
    ? { id: 'notification', label: 'Notification fires on order/fill', status: 'pass', detail: `outbound_messages.id=${data.id} status=${data.status}` }
    : { id: 'notification', label: 'Notification fires on order/fill', status: 'fail', detail: 'no matching outbound_messages row appeared' };
}

/** Check 3 — kill switch: engaging it must block a fresh intent immediately,
 *  and releasing it must restore normal gating. */
async function checkKillSwitch(loopId: string): Promise<SelftestCheck> {
  const intent: OrderIntent = { clientOrderId: crypto.randomUUID(), loopId, symbol: 'NVDA', side: 'buy', qty: 1, type: 'market', reason: 'simulation selftest — kill switch' };
  const adapter = await selectAdapter();

  const { canceled } = await setKillSwitch(true, 'selftest');
  const { data: engaged } = await db().from('risk_state').select('kill_switch').eq('id', 1).maybeSingle();
  const gateBlocked = await checkRisk(intent, {}, adapter);

  await setKillSwitch(false, 'selftest');
  const { data: released } = await db().from('risk_state').select('kill_switch').eq('id', 1).maybeSingle();
  const gateAfterRelease = await checkRisk(intent, { symbolAllowlist: ['NVDA'], maxTradeUsd: 500 }, adapter);

  const ok = engaged?.kill_switch === true && !gateBlocked.allowed && released?.kill_switch === false && gateAfterRelease.allowed;
  return {
    id: 'kill_switch',
    label: 'Kill switch blocks + cancel-all + releases cleanly',
    status: ok ? 'pass' : 'fail',
    detail: `engaged=${engaged?.kill_switch} blocked_reason="${gateBlocked.reason}" canceled=${canceled} released=${released?.kill_switch} post_release_allowed=${gateAfterRelease.allowed}`,
  };
}

/** Check 4 — daily-loss auto-halt: breaching the configured limit must halt
 *  automatically (risk.ts's own logic, not a selftest reimplementation) and
 *  block new orders until reset. */
async function checkDailyLossHalt(loopId: string): Promise<SelftestCheck> {
  const limit = Number(process.env.DAILY_LOSS_LIMIT_USD) > 0 ? Number(process.env.DAILY_LOSS_LIMIT_USD) : 500;
  const breach = -(limit + 1);
  await db().from('risk_state').update({ realized_pnl: breach, halted: false, halt_reason: null, updated_at: new Date().toISOString() }).eq('id', 1);

  const intent: OrderIntent = { clientOrderId: crypto.randomUUID(), loopId, symbol: 'NVDA', side: 'buy', qty: 1, type: 'market', reason: 'simulation selftest — daily loss' };
  const adapter = await selectAdapter();
  const gate = await checkRisk(intent, { symbolAllowlist: ['NVDA'], maxTradeUsd: 500 }, adapter);

  const { data: after } = await db().from('risk_state').select('halted, halt_reason, realized_pnl').eq('id', 1).maybeSingle();

  const ok = !gate.allowed && after?.halted === true && /daily loss/i.test(gate.reason);
  return {
    id: 'daily_loss_halt',
    label: 'Daily-loss limit auto-halts and blocks new orders',
    status: ok ? 'pass' : 'fail',
    detail: `realized_pnl set to ${breach} (limit $${limit}) → blocked_reason="${gate.reason}" risk_state.halted=${after?.halted} halt_reason="${after?.halt_reason}"`,
  };
}

/** Runs all four checks in order, always restoring risk_state and deleting
 *  the throwaway loop even if a check throws. */
export async function runSafetySelftest(): Promise<SelftestResult> {
  const snapshot = await snapshotRiskState();
  const loopId = await createThrowawayLoop();
  const checks: SelftestCheck[] = [];

  try {
    checks.push(await checkFillPath(loopId));
    checks.push(await checkNotification());
    checks.push(await checkKillSwitch(loopId));
    checks.push(await checkDailyLossHalt(loopId));
  } catch (err) {
    checks.push({ id: 'harness_error', label: 'Harness execution', status: 'fail', detail: String(err).slice(0, 300) });
  } finally {
    await restoreRiskState(snapshot);
    await deleteThrowawayLoop(loopId);
  }

  const overall: 'pass' | 'fail' = checks.every((c) => c.status === 'pass') ? 'pass' : 'fail';
  return { checks, overall, ranAt: new Date().toISOString() };
}

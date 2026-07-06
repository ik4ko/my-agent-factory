// Privileged trading-control actions — arm/disarm, kill switch, halt.
// Distinct from the existing agent-orchestration emergency-stop (which only
// touches tasks/agents): these mutate risk_state, the single choke point
// every trade loop's execution path reads before touching a brokerage.
//
// Every caller (dashboard, phone SMS, voice) goes through verifyOperatorPin()
// first — session auth (middleware) is necessary but not sufficient, since a
// phone can be unlocked/stolen while still holding a valid session cookie.
import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { notify } from '@/lib/comms/transport';
import { selectAdapter } from '@/lib/execution/select-adapter';
import { timingSafeEqualStr } from '@/lib/auth/session';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

// Kept in sync with src/lib/golive/preflight.ts's DEFAULT_OPERATOR_PIN — the
// exact value this build generated in .env.local. Duplicated as a literal
// (not imported) so this hardening check can never silently break if the
// preflight module is ever refactored or removed.
const DEFAULT_OPERATOR_PIN = '552487';

/** Fails CLOSED — an unset OPERATOR_PIN means every privileged action is
 *  rejected, never silently allowed. */
export function verifyOperatorPin(pin: unknown): boolean {
  const configured = process.env.OPERATOR_PIN?.trim();
  if (!configured || typeof pin !== 'string' || !pin) return false;
  return timingSafeEqualStr(pin, configured);
}

/** Default-PIN lockout (§2e hardening): blocks ARMING ONLY (kill/halt/disarm
 *  stay available even on the default PIN, since those only ever make things
 *  safer) when OPERATOR_PIN is unset or still the generated default. This is
 *  independent of whether the submitted PIN happens to match — a correct
 *  match against a known-public default is not authorization. */
export function armLockoutReason(): string | null {
  const pin = process.env.OPERATOR_PIN?.trim();
  if (!pin) return 'OPERATOR_PIN is not set';
  if (pin === DEFAULT_OPERATOR_PIN) return 'OPERATOR_PIN is still the generated default — change it before arming';
  return null;
}

export async function setArmed(enabled: boolean, actor: string): Promise<{ ok: boolean; error?: string }> {
  if (enabled) {
    const lockout = armLockoutReason();
    if (lockout) {
      await hermesLog('warn', `[CONTROL] arm blocked — ${lockout} (actor=${actor})`);
      return { ok: false, error: lockout };
    }
  }

  await db()
    .from('risk_state')
    .update({ trading_enabled: enabled, updated_at: new Date().toISOString() })
    .eq('id', 1);
  await hermesLog(enabled ? 'warn' : 'info', `[CONTROL] trading ${enabled ? 'ARMED' : 'disarmed'} by ${actor}`);
  await notify(
    enabled
      ? `⚠️ TRADING ARMED by ${actor}. Loops will place real orders within caps until disarmed or killed.`
      : `Trading disarmed by ${actor}. All execution back to dry-run.`
  );
  return { ok: true };
}

/** Cancels every currently-submitted (not yet filled/rejected) order via
 *  whichever adapter is live. A no-op under DryRun/Bridge-not-configured —
 *  there's nothing at a broker to cancel in that case. */
async function cancelAllOpenOrders(): Promise<number> {
  const { data: open } = await db().from('orders').select('id, broker_id').eq('status', 'submitted');
  const rows = (open ?? []) as { id: string; broker_id: string | null }[];
  if (rows.length === 0) return 0;

  const adapter = await selectAdapter();
  let canceled = 0;
  for (const row of rows) {
    try {
      if (row.broker_id) await adapter.cancelOrder(row.broker_id);
      await db().from('orders').update({ status: 'canceled', updated_at: new Date().toISOString() }).eq('id', row.id);
      canceled++;
    } catch (err) {
      await hermesLog('error', `[CONTROL] cancel-all failed for order ${row.id.slice(0, 8)}: ${String(err).replace(/\s+/g, ' ').slice(0, 160)}`);
    }
  }
  return canceled;
}

export async function setKillSwitch(engaged: boolean, actor: string): Promise<{ canceled: number }> {
  await db()
    .from('risk_state')
    .update({ kill_switch: engaged, updated_at: new Date().toISOString() })
    .eq('id', 1);

  let canceled = 0;
  if (engaged) canceled = await cancelAllOpenOrders();

  await hermesLog(engaged ? 'error' : 'info', `[CONTROL] kill switch ${engaged ? 'ENGAGED' : 'released'} by ${actor}${engaged ? ` — ${canceled} open order(s) canceled` : ''}`);
  if (engaged) {
    await notify(`🛑 KILL SWITCH engaged by ${actor}. ${canceled} open order(s) canceled. No new orders until released.`);
  }
  return { canceled };
}

export async function setHalted(halted: boolean, reason: string | null, actor: string): Promise<void> {
  await db()
    .from('risk_state')
    .update({ halted, halt_reason: halted ? reason ?? `manual halt by ${actor}` : null, updated_at: new Date().toISOString() })
    .eq('id', 1);
  await hermesLog(halted ? 'error' : 'info', `[CONTROL] trading ${halted ? `HALTED by ${actor}: ${reason ?? 'no reason given'}` : `un-halted by ${actor}`}`);
}

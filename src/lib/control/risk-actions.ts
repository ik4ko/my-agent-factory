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

/** Fails CLOSED — an unset OPERATOR_PIN means every privileged action is
 *  rejected, never silently allowed. */
export function verifyOperatorPin(pin: unknown): boolean {
  const configured = process.env.OPERATOR_PIN?.trim();
  if (!configured || typeof pin !== 'string' || !pin) return false;
  return timingSafeEqualStr(pin, configured);
}

export async function setArmed(enabled: boolean, actor: string): Promise<void> {
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

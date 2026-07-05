// selectAdapter() — the one place that decides which brokerage backend a
// trade decision actually runs against. Read this before touching anything
// else in src/lib/execution/.
//
// Master-arm gate FIRST: while risk_state.trading_enabled is false (the
// default), EVERY caller gets DryRunAdapter, full stop — Direct/Bridge are
// never even probed. This is what makes "arm once, run continuously" safe:
// there is exactly one durable flip (trading_enabled true/false) and nothing
// downstream can talk to a real backend until it's set.
//
// Once armed, the chain is Direct (robin_stocks sidecar reachable +
// authenticated) → Bridge (executor-agent path configured) → DryRun as the
// final fallback — the system never ends up simply unable to record a
// decision, even mid-outage.
import { getAdminClient } from '@/lib/supabase/admin';
import { DryRunAdapter } from './dry-run-adapter';
import { DirectAdapter } from './direct-adapter';
import { BridgeAdapter } from './bridge-adapter';
import type { ExecutionAdapter } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export async function isTradingArmed(): Promise<boolean> {
  if (process.env.TRADING_ENABLED !== 'true') return false;
  const { data } = await db().from('risk_state').select('trading_enabled').eq('id', 1).maybeSingle();
  return Boolean(data?.trading_enabled);
}

export async function isKillSwitchOn(): Promise<boolean> {
  if (process.env.KILL_SWITCH === 'true') return true;
  const { data } = await db().from('risk_state').select('kill_switch, halted').eq('id', 1).maybeSingle();
  return Boolean(data?.kill_switch || data?.halted);
}

const dryRun = new DryRunAdapter();
const direct = new DirectAdapter();
const bridge = new BridgeAdapter();

export async function selectAdapter(): Promise<ExecutionAdapter> {
  if (!(await isTradingArmed())) return dryRun;

  if (await direct.isReady()) return direct;
  if (await bridge.isReady()) return bridge;
  return dryRun;
}

// Simulation-only adapter selection. There is deliberately no environment
// flag, credential, sidecar, or fallback capable of selecting a live broker.
import { getAdminClient } from '@/lib/supabase/admin';
import { DryRunAdapter } from './dry-run-adapter';
import type { ExecutionAdapter } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export async function isTradingArmed(): Promise<boolean> {
  const { data } = await db().from('risk_state').select('trading_enabled').eq('id', 1).maybeSingle();
  return Boolean(data?.trading_enabled);
}

export async function isKillSwitchOn(): Promise<boolean> {
  if (process.env.KILL_SWITCH === 'true') return true;
  const { data } = await db().from('risk_state').select('kill_switch, halted').eq('id', 1).maybeSingle();
  return Boolean(data?.kill_switch || data?.halted);
}

const dryRun = new DryRunAdapter();
export async function selectAdapter(): Promise<ExecutionAdapter> {
  return dryRun;
}

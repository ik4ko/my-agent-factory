// Go-Live preflight — a machine-checked red/green checklist. Nothing here
// mutates state except the one deliberate test notification (item 6), which
// is itself a real, auditable send through whatever transport is active.
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, sep } from 'path';
import { getAdminClient } from '@/lib/supabase/admin';
import { selectAdapter } from '@/lib/execution/select-adapter';
import { activeTransport } from '@/lib/comms/transport';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export const DEFAULT_OPERATOR_PIN = '552487';

export type CheckStatus = 'pass' | 'warn' | 'fail';
export interface PreflightCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}
export interface EffectiveCaps {
  maxTradeUsd: number;
  dailyLossLimitUsd: number;
  maxOpenPositions: number;
  symbolAllowlist: string[];
}
export interface PreflightResult {
  checks: PreflightCheck[];
  overall: CheckStatus;
  canArm: boolean;
  checkedAt: string;
  caps: EffectiveCaps;
}

// public.logs.timestamp is `timestamp` (no timezone), so Postgres returns it
// with no offset (e.g. "2026-07-05 23:33:05.848") while timestamptz columns
// like risk_state's come back with "+00". Node's Date parser treats a
// no-offset, space-separated string as LOCAL time, not UTC — on a host
// whose local zone isn't UTC that silently shifts "now" by hours. The
// column is genuinely stored as UTC, so force that reading explicitly.
function parseDbTimestamp(raw: string): Date {
  const hasOffset = /[zZ]|[+-]\d\d:?\d\d$/.test(raw);
  return new Date(hasOffset ? raw : `${raw.replace(' ', 'T')}Z`);
}

function envNumber(name: string): number | null {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

async function checkDbAndRiskState(): Promise<PreflightCheck[]> {
  const out: PreflightCheck[] = [];
  try {
    const { data, error } = await db().from('risk_state').select('*').eq('id', 1).maybeSingle();
    if (error) throw new Error(error.message);
    out.push({ id: 'db', label: 'Database reachable', status: 'pass', detail: 'risk_state query succeeded' });

    if (!data) {
      out.push({ id: 'risk_state', label: 'risk_state singleton', status: 'fail', detail: 'no row with id=1 — run the Phase 0 migration' });
      return out;
    }
    const problems: string[] = [];
    if (data.halted && !data.halt_reason) problems.push('halted=true but halt_reason is empty');
    if (typeof data.trading_enabled !== 'boolean') problems.push('trading_enabled is not boolean');
    out.push({
      id: 'risk_state',
      label: 'risk_state internally consistent',
      status: problems.length ? 'warn' : 'pass',
      detail: problems.length ? problems.join('; ') : `day=${data.day} regime=${data.regime}`,
    });

    out.push({
      id: 'kill_halt_feed',
      label: 'Kill switch released, not halted, feed ok',
      status: data.kill_switch || data.halted || data.feed_degraded ? 'fail' : 'pass',
      detail: `kill_switch=${data.kill_switch} halted=${data.halted}${data.halt_reason ? `(${data.halt_reason})` : ''} feed_degraded=${data.feed_degraded}`,
    });
  } catch (err) {
    out.push({ id: 'db', label: 'Database reachable', status: 'fail', detail: String(err).slice(0, 200) });
  }
  return out;
}

async function checkAdapter(): Promise<PreflightCheck> {
  try {
    const adapter = await selectAdapter();
    const ready = await adapter.isReady();
    const armed = process.env.TRADING_ENABLED === 'true';
    if (!armed) {
      return { id: 'adapter', label: 'Execution adapter', status: 'pass', detail: `dryrun (trading not armed) — ready=${ready}` };
    }
    return {
      id: 'adapter',
      label: 'Execution adapter',
      status: adapter.name === 'dryrun' ? 'warn' : ready ? 'pass' : 'fail',
      detail: `armed → selectAdapter() picked "${adapter.name}", ready=${ready}`,
    };
  } catch (err) {
    return { id: 'adapter', label: 'Execution adapter', status: 'fail', detail: String(err).slice(0, 200) };
  }
}

function effectiveCaps(): EffectiveCaps {
  return {
    maxTradeUsd: envNumber('MAX_TRADE_USD') ?? 250,
    dailyLossLimitUsd: envNumber('DAILY_LOSS_LIMIT_USD') ?? 500,
    maxOpenPositions: envNumber('MAX_OPEN_POSITIONS') ?? 5,
    symbolAllowlist: process.env.SYMBOL_ALLOWLIST?.trim().split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) ?? [],
  };
}

function checkCaps(): PreflightCheck[] {
  const out: PreflightCheck[] = [];
  const maxTrade = envNumber('MAX_TRADE_USD');
  const dailyLoss = envNumber('DAILY_LOSS_LIMIT_USD');
  const maxPositions = envNumber('MAX_OPEN_POSITIONS');
  const allowlist = process.env.SYMBOL_ALLOWLIST?.trim();

  out.push({
    id: 'cap_max_trade',
    label: 'MAX_TRADE_USD configured',
    status: maxTrade ? 'pass' : 'warn',
    detail: maxTrade ? `$${maxTrade}` : 'unset — falling back to code default ($250)',
  });
  out.push({
    id: 'cap_daily_loss',
    label: 'DAILY_LOSS_LIMIT_USD configured',
    status: dailyLoss ? 'pass' : 'warn',
    detail: dailyLoss ? `$${dailyLoss}` : 'unset — falling back to code default ($500)',
  });
  out.push({
    id: 'cap_max_positions',
    label: 'MAX_OPEN_POSITIONS configured',
    status: maxPositions ? 'pass' : 'warn',
    detail: maxPositions ? String(maxPositions) : 'unset — falling back to code default (5)',
  });
  out.push({
    id: 'cap_allowlist',
    label: 'SYMBOL_ALLOWLIST non-empty',
    status: allowlist ? 'pass' : 'fail',
    detail: allowlist ? allowlist : 'unset — every symbol would be tradeable, unacceptable for live trading',
  });
  return out;
}

async function checkWorkerHeartbeat(): Promise<PreflightCheck> {
  const { data } = await db()
    .from('logs')
    .select('timestamp')
    .ilike('message', '%[LOOP-WORKER]%')
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return { id: 'worker', label: 'Loop worker heartbeat', status: 'fail', detail: 'no [LOOP-WORKER] log line ever seen — is scripts/loop-worker.mts running?' };

  const ageMs = Math.max(0, Date.now() - parseDbTimestamp(data.timestamp).getTime());
  if (ageMs < 90_000) return { id: 'worker', label: 'Loop worker heartbeat', status: 'pass', detail: `last heartbeat ${Math.round(ageMs / 1000)}s ago` };
  if (ageMs < 5 * 60_000) return { id: 'worker', label: 'Loop worker heartbeat', status: 'warn', detail: `last heartbeat ${Math.round(ageMs / 1000)}s ago — check the worker is still running` };
  return { id: 'worker', label: 'Loop worker heartbeat', status: 'fail', detail: `last heartbeat ${Math.round(ageMs / 60_000)}min ago — worker appears stalled or stopped` };
}

async function checkNotificationTransport(): Promise<PreflightCheck> {
  try {
    const transport = activeTransport();
    const marker = `[PREFLIGHT] test notification ${Date.now()}`;
    await transport.send(process.env.OPERATOR_PHONE?.trim() || 'operator', marker, 'summary');
    const { data } = await db().from('outbound_messages').select('id').eq('body', marker).limit(1).maybeSingle();
    return data
      ? { id: 'notify', label: 'Notification transport', status: 'pass', detail: `${transport.name} — test message landed in outbound_messages` }
      : { id: 'notify', label: 'Notification transport', status: 'fail', detail: `${transport.name} — test message did not appear in outbound_messages` };
  } catch (err) {
    return { id: 'notify', label: 'Notification transport', status: 'fail', detail: String(err).slice(0, 200) };
  }
}

function checkOperatorPin(): PreflightCheck {
  const pin = process.env.OPERATOR_PIN?.trim();
  if (!pin) return { id: 'pin', label: 'OPERATOR_PIN', status: 'fail', detail: 'unset — every PIN-gated action fails closed, including arm' };
  if (pin === DEFAULT_OPERATOR_PIN) return { id: 'pin', label: 'OPERATOR_PIN', status: 'fail', detail: 'still the generated default — arm is blocked until you change it' };
  return { id: 'pin', label: 'OPERATOR_PIN', status: 'pass', detail: 'set and non-default' };
}

/** Walks src/ looking for any write of trading_enabled outside
 *  risk-actions.ts's setArmed(). Source-scan only works when the running
 *  process has the repo's source tree on disk (true for `next dev` / a
 *  standard Node deploy of this repo; not guaranteed in every hosting
 *  setup) — when it can't scan, this warns rather than blocking arm on an
 *  environment limitation instead of an actual violation. */
function checkSingleWriter(): PreflightCheck {
  // risk-actions.ts is the real writer (setArmed). selftest.ts's
  // restoreRiskState() also touches the column, but only ever restores a
  // PRIOR snapshot as part of the self-cleaning safety harness — it can
  // never independently turn trading_enabled on, so it's an audited,
  // intentional exception rather than a second writer.
  const ALLOWED_FILES = new Set([join('src', 'lib', 'control', 'risk-actions.ts'), join('src', 'lib', 'golive', 'selftest.ts')]);
  // Requires an actual `.update({ ...trading_enabled... })` call, not just
  // any mention of the field name (e.g. a type declaration or a JSON
  // response echoing back what the caller asked for).
  const WRITE_PATTERN = /\.update\(\s*\{[\s\S]{0,300}?trading_enabled\s*:[\s\S]{0,300}?\}\s*\)/;
  const violations: string[] = [];

  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (entry === 'node_modules' || entry === '.next') continue;
        walk(full);
      } else if (/\.(ts|tsx|mts)$/.test(entry)) {
        const rel = full.replace(process.cwd() + sep, '');
        if (ALLOWED_FILES.has(rel)) continue;
        const content = readFileSync(full, 'utf8');
        if (WRITE_PATTERN.test(content)) violations.push(rel);
      }
    }
  }

  try {
    walk(join(process.cwd(), 'src'));
    return violations.length === 0
      ? { id: 'single_writer', label: 'Single-writer guard (trading_enabled)', status: 'pass', detail: 'only risk-actions.ts writes trading_enabled' }
      : { id: 'single_writer', label: 'Single-writer guard (trading_enabled)', status: 'fail', detail: `also written in: ${violations.join(', ')}` };
  } catch (err) {
    return { id: 'single_writer', label: 'Single-writer guard (trading_enabled)', status: 'warn', detail: `could not scan source: ${String(err).slice(0, 120)}` };
  }
}

export async function runPreflight(): Promise<PreflightResult> {
  const checks: PreflightCheck[] = [
    ...(await checkDbAndRiskState()),
    await checkAdapter(),
    ...checkCaps(),
    await checkWorkerHeartbeat(),
    await checkNotificationTransport(),
    checkOperatorPin(),
    checkSingleWriter(),
  ];

  const overall: CheckStatus = checks.some((c) => c.status === 'fail') ? 'fail' : checks.some((c) => c.status === 'warn') ? 'warn' : 'pass';
  return { checks, overall, canArm: overall !== 'fail', checkedAt: new Date().toISOString(), caps: effectiveCaps() };
}

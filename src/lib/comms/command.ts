// Transport-agnostic command core — the single parse → authorize → execute
// → reply pipeline used by the dashboard simulator and trusted text clients.
// A channel adapter's
// only job is: get text in, call runCommand(parseCommand(text), ctx), get a
// reply string out.
//
// Authorization lives HERE, not in any transport: every state-changing verb
// (arm/disarm/kill/halt/resume/new/pause) requires the operator's PIN as its
// first argument, checked with the exact same verifyOperatorPin() the
// dashboard's /api/control/* routes use — fails closed if OPERATOR_PIN is
// unset. Read-only verbs (status/pnl/positions/loops/help) need no PIN.
import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { setArmed, setKillSwitch, setHalted, verifyOperatorPin } from '@/lib/control/risk-actions';
import { selectAdapter } from '@/lib/execution/select-adapter';
import { AgentRegistry } from '@/lib/agents/registry';
import type { LoopKind } from '@/lib/types/database.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export type Command =
  | { type: 'status' }
  | { type: 'pnl' }
  | { type: 'positions' }
  | { type: 'loops' }
  | { type: 'help' }
  | { type: 'arm'; pin: string }
  | { type: 'disarm'; pin: string }
  | { type: 'kill'; pin: string }
  | { type: 'halt'; pin: string }
  | { type: 'resume'; pin: string }
  | { type: 'new'; pin: string; objective: string }
  | { type: 'pause'; pin: string; target: string }
  | { type: 'unknown'; raw: string };

export interface CommandContext {
  /** Human-readable source used only for audit logs, never for auth. */
  actor: string;
}

const HELP_TEXT =
  'status | pnl | positions | loops | ' +
  'arm <PIN> | disarm <PIN> | kill <PIN> | halt <PIN> | resume <PIN> | ' +
  'new <PIN> <objective> | pause <PIN> <loop name or id> | help';

/** Pure text → Command. Never throws — an unparseable line becomes
 *  {type:'unknown'} so runCommand can reply with help instead of crashing
 *  the channel that called it. */
export function parseCommand(text: string): Command {
  const trimmed = text.trim();
  if (!trimmed) return { type: 'unknown', raw: text };

  const [verbRaw, ...rest] = trimmed.split(/\s+/);
  const verb = verbRaw.toLowerCase();

  switch (verb) {
    case 'status':
      return { type: 'status' };
    case 'pnl':
      return { type: 'pnl' };
    case 'positions':
      return { type: 'positions' };
    case 'loops':
      return { type: 'loops' };
    case 'help':
      return { type: 'help' };
    case 'arm':
      return rest[0] ? { type: 'arm', pin: rest[0] } : { type: 'unknown', raw: text };
    case 'disarm':
      return rest[0] ? { type: 'disarm', pin: rest[0] } : { type: 'unknown', raw: text };
    case 'kill':
      return rest[0] ? { type: 'kill', pin: rest[0] } : { type: 'unknown', raw: text };
    case 'halt':
      return rest[0] ? { type: 'halt', pin: rest[0] } : { type: 'unknown', raw: text };
    case 'resume':
      return rest[0] ? { type: 'resume', pin: rest[0] } : { type: 'unknown', raw: text };
    case 'new':
      return rest.length >= 2 ? { type: 'new', pin: rest[0], objective: rest.slice(1).join(' ') } : { type: 'unknown', raw: text };
    case 'pause':
      return rest.length >= 2 ? { type: 'pause', pin: rest[0], target: rest.slice(1).join(' ') } : { type: 'unknown', raw: text };
    default:
      return { type: 'unknown', raw: text };
  }
}

async function requirePin(pin: string, ctx: CommandContext, action: string): Promise<string | null> {
  if (verifyOperatorPin(pin)) return null;
  await hermesLog('warn', `[COMMAND] ${action} rejected — invalid PIN (actor=${ctx.actor})`);
  return 'rejected: invalid PIN';
}

async function describeStatus(): Promise<string> {
  const { data: risk } = await db().from('risk_state').select('*').eq('id', 1).maybeSingle();
  const adapter = await selectAdapter();
  if (!risk) return 'risk_state unavailable';
  const bits = [
    `regime=${risk.regime}`,
    risk.trading_enabled ? 'ARMED' : 'disarmed',
    risk.kill_switch ? 'KILL ENGAGED' : 'kill clear',
    risk.halted ? `HALTED(${risk.halt_reason ?? 'unspecified'})` : 'not halted',
    risk.feed_degraded ? 'feed degraded' : 'feed ok',
    `adapter=${adapter.name}`,
  ];
  return bits.join(' · ');
}

/** Execute an already-parsed command. Every branch audits to `logs`; state
 *  mutations reuse the exact same services the dashboard control endpoints
 *  and Compose page call — this file has no bespoke DB-mutation logic of
 *  its own beyond the read-only summaries. */
export async function runCommand(cmd: Command, ctx: CommandContext): Promise<{ reply: string; mutated?: boolean }> {
  await hermesLog('info', `[COMMAND] ${ctx.actor}: ${cmd.type}`);

  switch (cmd.type) {
    case 'status':
      return { reply: await describeStatus() };

    case 'pnl': {
      const { data: risk } = await db().from('risk_state').select('day, realized_pnl').eq('id', 1).maybeSingle();
      return { reply: risk ? `P&L (${risk.day}): $${Number(risk.realized_pnl).toFixed(2)}` : 'pnl unavailable' };
    }

    case 'positions': {
      const adapter = await selectAdapter();
      const positions = await adapter.getPositions();
      if (positions.length === 0) return { reply: `no open positions (${adapter.name})` };
      return { reply: positions.map((p) => `${p.symbol} ${p.qty}@$${p.avgCost.toFixed(2)}`).join(', ') };
    }

    case 'loops': {
      const { data } = await db().from('loops').select('name, status, kind').order('created_at', { ascending: false }).limit(10);
      const rows = (data ?? []) as { name: string; status: string; kind: string }[];
      if (rows.length === 0) return { reply: 'no loops yet — try: new <PIN> <objective>' };
      return { reply: rows.map((l) => `${l.name}[${l.kind}]:${l.status}`).join(', ') };
    }

    case 'help':
      return { reply: HELP_TEXT };

    case 'arm': {
      const err = await requirePin(cmd.pin, ctx, 'arm');
      if (err) return { reply: err };
      const result = await setArmed(true, ctx.actor);
      if (!result.ok) return { reply: `arm blocked: ${result.error}` };
      return { reply: 'simulation ARMED — loops record paper orders within caps; no broker is connected', mutated: true };
    }

    case 'disarm': {
      const err = await requirePin(cmd.pin, ctx, 'disarm');
      if (err) return { reply: err };
      await setArmed(false, ctx.actor);
      return { reply: 'simulation disarmed — paper execution paused', mutated: true };
    }

    case 'kill': {
      const err = await requirePin(cmd.pin, ctx, 'kill');
      if (err) return { reply: err };
      const { canceled } = await setKillSwitch(true, ctx.actor);
      return { reply: `KILL engaged — ${canceled} open order(s) canceled`, mutated: true };
    }

    case 'halt': {
      const err = await requirePin(cmd.pin, ctx, 'halt');
      if (err) return { reply: err };
      await setHalted(true, `manual halt via command (${ctx.actor})`, ctx.actor);
      return { reply: 'trading halted', mutated: true };
    }

    case 'resume': {
      const err = await requirePin(cmd.pin, ctx, 'resume');
      if (err) return { reply: err };
      await setHalted(false, null, ctx.actor);
      await setKillSwitch(false, ctx.actor);
      return { reply: 'halt cleared and kill switch released (trading_enabled unchanged)', mutated: true };
    }

    case 'new': {
      const err = await requirePin(cmd.pin, ctx, 'new');
      if (err) return { reply: err };
      const kind: LoopKind = 'trade';
      const name = cmd.objective.slice(0, 60);
      const { data, error } = await db()
        .from('loops')
        .insert({ name, kind, objective: cmd.objective, status: 'paused', cadence_seconds: 60, triggers: [], config: {}, brain: 'claude' })
        .select('id, name')
        .single();
      if (error) return { reply: `create failed: ${error.message.slice(0, 100)}` };
      return { reply: `created loop "${(data as { name: string }).name}" (paused — arm it from the dashboard)`, mutated: true };
    }

    case 'pause': {
      const err = await requirePin(cmd.pin, ctx, 'pause');
      if (err) return { reply: err };
      const target = cmd.target.trim();
      const query = db().from('loops').update({ status: 'paused', next_tick_at: null, lock_owner: null, lock_at: null });
      const { data, error } = /^[0-9a-f-]{36}$/i.test(target)
        ? await query.eq('id', target).select('name').maybeSingle()
        : await query.ilike('name', target).select('name').maybeSingle();
      if (error) return { reply: `pause failed: ${error.message.slice(0, 100)}` };
      if (!data) return { reply: `no loop matching "${target}"` };
      return { reply: `paused "${(data as { name: string }).name}"`, mutated: true };
    }

    case 'unknown':
    default: {
      // Background brain pipe: a non-command text routes silently to the
      // orchestrator brain (read-only — no PIN needed since nothing mutates)
      // and the exchange lands as a terminal log line. Command verbs above
      // are matched FIRST, so no state-changing word can ever reach a model.
      const raw = 'raw' in cmd ? cmd.raw.trim() : '';
      if (raw.length >= 4) {
        try {
          const thought = await AgentRegistry.CLAUDE.think({
            system: 'You are Claude, the active command assistant for My Agent Factory. Reply briefly. This is read-only command help; do not claim to mutate state.',
            prompt: raw,
            maxTokens: 220,
            ledger: { detail: `comms:command:${ctx.actor}` },
          });
          await hermesLog('info', `[COMMS->CLAUDE] "${raw.slice(0, 60)}${raw.length > 60 ? '...' : ''}" replied via ${thought.model} (${ctx.actor})`);
          return { reply: thought.text.slice(0, 480) };
        } catch (err) {
          await hermesLog('warn', `[COMMS->CLAUDE] brain pipe failed (${err instanceof Error ? err.message : 'unknown'}) - falling back to help (${ctx.actor})`);
        }
      }
      return { reply: `unrecognized command "${raw}". ${HELP_TEXT}` };
    }
  }
}

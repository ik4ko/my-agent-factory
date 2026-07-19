import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { notify } from '@/lib/comms/transport';
import { checkRisk } from '@/lib/execution/risk';
import { selectAdapter } from '@/lib/execution/select-adapter';
import { runLoop } from '@/lib/loops/engine';
import type { LoopRow, OrderRow, RiskStateRow } from '@/lib/types/database.types';
import type { OrderIntent, OrderResult } from '@/lib/execution/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

const DIRECT_LOOP_NAME = 'Operator Direct Orders';
const DEFAULT_MANDATE_NAME = 'Autonomous Trading Mandate';
const MAX_PULSE_LOOPS = 3;

export interface ParsedDirectOrder {
  kind: 'direct_order';
  symbol: string;
  side: 'buy' | 'sell';
  qty?: number;
  notional?: number;
  type: 'market' | 'limit';
  limitPrice?: number;
  reason: string;
}

export type TradingCommand =
  | { kind: 'none' }
  | { kind: 'pulse'; reason: string }
  | ParsedDirectOrder
  | { kind: 'unsupported'; reason: string };

export interface TradingAutonomyStatus {
  tradingEnabled: boolean;
  halted: boolean;
  killSwitch: boolean;
  haltReason: string | null;
  regime: string;
  activeMandates: Array<Pick<LoopRow, 'id' | 'name' | 'objective' | 'status' | 'brain' | 'updated_at'>>;
  recentOrders: OrderRow[];
  caps: {
    symbolAllowlist: string[];
    maxTradeUsd: number;
    dailyLossLimitUsd: number;
    maxOpenPositions: number;
    maxOrdersPerHour: number;
  };
}

export interface PulsePreparation {
  accepted: boolean;
  reply: string;
  loops: LoopRow[];
}

export interface DirectOrderExecution {
  reply: string;
  order?: OrderRow;
  result?: OrderResult;
  blocked?: boolean;
  adapter: string;
}

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function envAllowlist(): string[] {
  const raw = process.env.SYMBOL_ALLOWLIST?.trim();
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
}

function cleanCommand(message: string): string {
  return message
    .trim()
    .replace(/^nova[,\s]+/i, '')
    .replace(/[.!?]+$/g, '')
    .trim();
}

function parsePositive(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function classifyTradingCommand(message: string): TradingCommand {
  const text = cleanCommand(message);
  const lower = text.toLowerCase();

  if (/\b(short|short\s+sell)\b/.test(lower)) {
    return {
      kind: 'unsupported',
      reason:
        'Short-selling is not wired as a direct live order in this dashboard. Use an options/defined-risk mandate once that strategy is explicitly configured.',
    };
  }

  const limitMatch = lower.match(/\blimit\s+(?:at\s+)?\$?(\d+(?:\.\d+)?)/);
  const limitPrice = parsePositive(limitMatch?.[1]);
  const type: 'market' | 'limit' = limitPrice ? 'limit' : 'market';

  // Examples: "buy $50 NVDA", "sell $25 of SPY"
  const notional = text.match(/^(?:please\s+)?(buy|sell)\s+\$?([\d,]+(?:\.\d+)?)\s+(?:worth\s+of\s+|of\s+)?\$?([A-Z]{1,6})\b/i);
  if (notional) {
    const side = notional[1].toLowerCase() as 'buy' | 'sell';
    const amount = parsePositive(notional[2]);
    const symbol = notional[3].toUpperCase();
    if (amount) {
      return {
        kind: 'direct_order',
        side,
        symbol,
        notional: amount,
        type,
        ...(limitPrice ? { limitPrice } : {}),
        reason: `direct operator command: ${text.slice(0, 180)}`,
      };
    }
  }

  // Examples: "buy 2 NVDA", "sell 1.5 shares of QQQ"
  const qty = text.match(/^(?:please\s+)?(buy|sell)\s+([\d,]+(?:\.\d+)?)\s*(?:shares?|sh)?\s+(?:of\s+)?\$?([A-Z]{1,6})\b/i);
  if (qty) {
    const side = qty[1].toLowerCase() as 'buy' | 'sell';
    const amount = parsePositive(qty[2]);
    const symbol = qty[3].toUpperCase();
    if (amount) {
      return {
        kind: 'direct_order',
        side,
        symbol,
        qty: amount,
        type,
        ...(limitPrice ? { limitPrice } : {}),
        reason: `direct operator command: ${text.slice(0, 180)}`,
      };
    }
  }

  if (
    /\b(go\s+make\s+a\s+trade|make\s+a\s+trade|find\s+(?:me\s+)?a\s+trade|take\s+a\s+trade|trade\s+now|buy\s+now|sell\s+now)\b/i.test(
      text,
    )
  ) {
    return { kind: 'pulse', reason: text };
  }

  return { kind: 'none' };
}

async function ensureDirectOrderLoop(): Promise<LoopRow> {
  const { data: existing, error: readError } = await db()
    .from('loops')
    .select('*')
    .eq('name', DIRECT_LOOP_NAME)
    .eq('kind', 'trade')
    .limit(1)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (existing) return existing as LoopRow;

  const { data, error } = await db()
    .from('loops')
    .insert({
      name: DIRECT_LOOP_NAME,
      kind: 'trade',
      objective: 'Audit shell for explicit operator direct equity orders. Never runs on cadence.',
      status: 'paused',
      cadence_seconds: null,
      triggers: [],
      config: { directOperator: true, maxTradeUsd: envNumber('MAX_TRADE_USD', 250) },
      brain: 'claude',
      next_tick_at: null,
    })
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? 'failed to create direct order audit loop');
  return data as LoopRow;
}

async function ensureDefaultMandate(): Promise<LoopRow> {
  const { data: existing, error: readError } = await db()
    .from('loops')
    .select('*')
    .eq('name', DEFAULT_MANDATE_NAME)
    .eq('kind', 'trade')
    .limit(1)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (existing) return existing as LoopRow;

  const allowlist = envAllowlist();
  const objective =
    'Autonomously scan the active watchlist for one well-supported, risk-defined equity trade. Act only when evidence, risk/reward, liquidity, and current regime support the setup; otherwise hold.';
  const { data, error } = await db()
    .from('loops')
    .insert({
      name: DEFAULT_MANDATE_NAME,
      kind: 'trade',
      objective,
      status: 'paused',
      cadence_seconds: null,
      triggers: [{ type: 'manual' }],
      config: {
        autonomousMandate: true,
        maxTradeUsd: envNumber('MAX_TRADE_USD', 250),
        maxOpenPositions: envNumber('MAX_OPEN_POSITIONS', 5),
        symbolAllowlist: allowlist,
        requireContraryEvidence: true,
      },
      brain: 'claude',
      next_tick_at: null,
    })
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? 'failed to create default mandate');
  await hermesLog('info', `[TRADING] created paused default autonomous mandate "${DEFAULT_MANDATE_NAME}"`);
  return data as LoopRow;
}

export async function getActiveTradingMandates(limit = MAX_PULSE_LOOPS): Promise<LoopRow[]> {
  const { data, error } = await db()
    .from('loops')
    .select('*')
    .eq('kind', 'trade')
    .eq('status', 'armed')
    .order('updated_at', { ascending: false })
    .limit(Math.max(limit * 3, 10));
  if (error) throw new Error(error.message);
  return ((data ?? []) as LoopRow[])
    .filter((loop) => (loop.config as { directOperator?: boolean } | null)?.directOperator !== true)
    .slice(0, limit);
}

export async function prepareAutonomousTradePulse(reason: string): Promise<PulsePreparation> {
  const loops = await getActiveTradingMandates();
  if (loops.length === 0) {
    const mandate = await ensureDefaultMandate();
    return {
      accepted: false,
      loops: [],
      reply: `No armed autonomous trading mandate is active yet. I created/found "${mandate.name}" in paused mode; arm the mandate once with your caps, then “go make a trade” will run without per-trade approval.`,
    };
  }

  return {
    accepted: true,
    loops,
    reply: `Autonomous trading pulse started across ${loops.length} armed mandate${loops.length === 1 ? '' : 's'}. Claude will only act inside the configured caps; otherwise it will hold or the risk gate will block.`,
  };
}

export async function runAutonomousTradePulse(loops: LoopRow[], reason: string): Promise<void> {
  for (const loop of loops) {
    try {
      await hermesLog('info', `[TRADING] manual autonomy pulse → ${loop.name}: ${reason.slice(0, 120)}`);
      await runLoop(loop, { type: 'manual' });
    } catch (err) {
      await hermesLog('error', `[TRADING] mandate pulse failed for ${loop.name}: ${String(err).replace(/\s+/g, ' ').slice(0, 160)}`);
    }
  }
}

export async function executeDirectOperatorOrder(order: ParsedDirectOrder): Promise<DirectOrderExecution> {
  const loop = await ensureDirectOrderLoop();
  const intent: OrderIntent = {
    clientOrderId: crypto.randomUUID(),
    loopId: loop.id,
    symbol: order.symbol,
    side: order.side,
    ...(order.qty ? { qty: order.qty } : {}),
    ...(order.notional ? { notional: order.notional } : {}),
    type: order.type,
    ...(order.limitPrice ? { limitPrice: order.limitPrice } : {}),
    reason: order.reason,
  };

  const adapter = await selectAdapter();
  const gate = await checkRisk(intent, loop.config, adapter);
  if (!gate.allowed) {
    const { data, error } = await db()
      .from('orders')
      .insert({
        loop_id: loop.id,
        symbol: intent.symbol,
        side: intent.side,
        qty: intent.qty ?? null,
        notional: intent.notional ?? null,
        type: intent.type,
        limit_price: intent.limitPrice ?? null,
        status: 'risk_blocked',
        reason: gate.reason,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await hermesLog('warn', `[TRADING] direct operator order blocked: ${intent.side} ${intent.symbol} — ${gate.reason}`);
    return {
      adapter: adapter.name,
      blocked: true,
      order: data as OrderRow,
      reply: `Order blocked by risk gate: ${gate.reason}`,
    };
  }

  const result = await adapter.placeOrder(intent);
  const { data, error } = await db()
    .from('orders')
    .upsert({
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
      reason: result.reason ?? intent.reason,
    }, { onConflict: 'client_order_id' })
    .select()
    .single();
  if (error) throw new Error(error.message);

  await hermesLog(
    result.status === 'dry_run' ? 'info' : 'success',
    `[TRADING] direct operator order ${intent.side} ${intent.symbol} via ${adapter.name} → ${result.status}`,
  );
  if (result.status !== 'dry_run') {
    await notify(`[DIRECT] ${intent.side.toUpperCase()} ${intent.symbol} → ${result.status}. ${intent.reason}`);
  }

  const size = intent.notional ? `$${intent.notional.toFixed(2)}` : `${intent.qty} share${intent.qty === 1 ? '' : 's'}`;
  return {
    adapter: adapter.name,
    result,
    order: data as OrderRow,
    reply:
      result.status === 'dry_run'
        ? `Paper order recorded: ${intent.side.toUpperCase()} ${size} ${intent.symbol}. No live broker connection exists.`
        : `Simulation result: ${intent.side.toUpperCase()} ${size} ${intent.symbol}; status ${result.status}.`,
  };
}

export async function getTradingAutonomyStatus(): Promise<TradingAutonomyStatus> {
  const [{ data: risk, error: riskError }, { data: mandates, error: mandateError }, { data: orders, error: orderError }] =
    await Promise.all([
      db().from('risk_state').select('*').eq('id', 1).maybeSingle(),
      db().from('loops').select('id, name, objective, status, brain, updated_at').eq('kind', 'trade').eq('status', 'armed').order('updated_at', { ascending: false }).limit(5),
      db().from('orders').select('*').order('created_at', { ascending: false }).limit(8),
    ]);

  if (riskError) throw new Error(riskError.message);
  if (mandateError) throw new Error(mandateError.message);
  if (orderError) throw new Error(orderError.message);

  const row = risk as RiskStateRow | null;
  return {
    tradingEnabled: Boolean(row?.trading_enabled),
    halted: Boolean(row?.halted),
    killSwitch: Boolean(row?.kill_switch),
    haltReason: row?.halt_reason ?? null,
    regime: row?.regime ?? 'UNKNOWN',
    activeMandates: (mandates ?? []) as TradingAutonomyStatus['activeMandates'],
    recentOrders: (orders ?? []) as OrderRow[],
    caps: {
      symbolAllowlist: envAllowlist(),
      maxTradeUsd: envNumber('MAX_TRADE_USD', 250),
      dailyLossLimitUsd: envNumber('DAILY_LOSS_LIMIT_USD', 500),
      maxOpenPositions: envNumber('MAX_OPEN_POSITIONS', 5),
      maxOrdersPerHour: envNumber('MAX_ORDERS_PER_HOUR', 20),
    },
  };
}

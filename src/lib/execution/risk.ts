// Risk gate — MANDATORY, non-negotiable. Runs for EVERY trade-kind order
// intent, before ANY adapter is ever called, regardless of whether trading
// is armed. When it blocks, the order never reaches an adapter at all: the
// engine records status='risk_blocked' and stops. When it passes, the
// engine proceeds to selectAdapter().placeOrder() — which itself still
// always yields simulation execution after these gates pass.
//
// Caps are read from env AND the loop's own config; the STRICTER of the two
// always wins (a loop can only narrow its own limits, never widen the
// operator's floor).
import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import type { ExecutionAdapter, OrderIntent } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export interface RiskCheckResult {
  allowed: boolean;
  reason: string;
}

interface LoopRiskConfig {
  maxTradeUsd?: number;
  symbolAllowlist?: string[];
  maxOpenPositions?: number;
}

function envNumber(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function envAllowlist(): string[] | null {
  const raw = process.env.SYMBOL_ALLOWLIST?.trim();
  if (!raw) return null;
  return raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
}

const DEFAULT_ORDERS_PER_HOUR = 20;
const STALE_QUOTE_MINUTES = 15;
const FAT_FINGER_PCT = 10; // reject limit orders priced >10% away from last quote

/**
 * Runs every check and returns on the FIRST failure (fail-fast, most severe
 * first: kill switch → halt → daily loss → allowlist → size → positions →
 * rate limit → sanity). Never throws — a risk-gate crash must fail CLOSED
 * (blocked), never open, so any unexpected error is caught and reported as
 * a block with the error text as the reason.
 */
export async function checkRisk(
  intent: OrderIntent,
  loopConfig: Record<string, unknown>,
  adapter: ExecutionAdapter
): Promise<RiskCheckResult> {
  try {
    const cfg = loopConfig as LoopRiskConfig;

    // 1. Kill switch / halt — checked first, unconditionally.
    if (process.env.KILL_SWITCH === 'true') return blocked('kill switch engaged (env)');
    const { data: risk } = await db().from('risk_state').select('*').eq('id', 1).maybeSingle();
    if (risk?.kill_switch) return blocked('kill switch engaged');
    if (risk?.halted) return blocked(`trading halted: ${risk.halt_reason ?? 'unspecified'}`);

    // 2. Daily loss limit — auto-halt ALL trade loops for the day when breached.
    const dailyLossLimit = envNumber('DAILY_LOSS_LIMIT_USD', 500);
    const realizedPnl = Number(risk?.realized_pnl ?? 0);
    if (realizedPnl <= -dailyLossLimit) {
      await db()
        .from('risk_state')
        .update({ halted: true, halt_reason: `daily loss limit hit ($${Math.abs(realizedPnl).toFixed(2)} ≥ $${dailyLossLimit})`, updated_at: new Date().toISOString() })
        .eq('id', 1);
      await hermesLog('error', `[RISK] AUTO-HALT: daily loss limit breached (realized_pnl=${realizedPnl})`);
      return blocked('daily loss limit breached — trading auto-halted for the day');
    }

    // 3. Symbol allowlist — loop's own list (if set) intersected with the env floor.
    const envList = envAllowlist();
    const loopList = Array.isArray(cfg.symbolAllowlist) ? cfg.symbolAllowlist.map((s) => s.toUpperCase()) : null;
    const effectiveAllowlist = envList && loopList ? envList.filter((s) => loopList.includes(s)) : envList ?? loopList;
    if (effectiveAllowlist && !effectiveAllowlist.includes(intent.symbol)) {
      return blocked(`${intent.symbol} not in symbol allowlist [${(effectiveAllowlist ?? []).join(',')}]`);
    }

    // 3b. Regime Controller overrides (src/lib/events/regime.ts) — tighten
    // only, never raises above the caps computed below. A blocked symbol is
    // stripped from the effective allowlist regardless of what step 3 said.
    const override = (risk?.symbol_overrides ?? {})[intent.symbol];
    if (override?.blocked) {
      return blocked(`${intent.symbol} blocked by regime controller: ${override.reason}`);
    }

    // 4. Max trade size — stricter of env vs loop config vs any regime
    // size-multiplier tightening for this symbol.
    const maxTradeUsd = Math.min(envNumber('MAX_TRADE_USD', 250), cfg.maxTradeUsd ?? Infinity) * (override?.sizeMultiplier ?? 1);
    let notional = intent.notional;
    if (notional === undefined && intent.qty !== undefined) {
      const quote = await adapter.getQuote(intent.symbol);
      notional = intent.qty * quote.price;
    }
    if (notional !== undefined && notional > maxTradeUsd) {
      return blocked(`order notional $${notional.toFixed(2)} exceeds max trade cap $${maxTradeUsd.toFixed(2)}`);
    }

    // 5. Max open positions — only matters when opening a NEW symbol.
    const maxOpenPositions = Math.min(envNumber('MAX_OPEN_POSITIONS', 5), cfg.maxOpenPositions ?? Infinity);
    const { data: openOrders } = await db()
      .from('orders')
      .select('symbol')
      .in('status', ['submitted', 'filled']);
    const openSymbols = new Set(((openOrders ?? []) as { symbol: string }[]).map((o) => o.symbol));
    if (!openSymbols.has(intent.symbol) && openSymbols.size >= maxOpenPositions) {
      return blocked(`max open positions reached (${openSymbols.size}/${maxOpenPositions})`);
    }

    // 6. Orders/hour rate limit — global, across all loops.
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const { count } = await db()
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', hourAgo)
      .not('status', 'eq', 'risk_blocked');
    const ordersPerHourLimit = envNumber('MAX_ORDERS_PER_HOUR', DEFAULT_ORDERS_PER_HOUR);
    if ((count ?? 0) >= ordersPerHourLimit) {
      return blocked(`orders/hour rate limit reached (${count}/${ordersPerHourLimit})`);
    }

    // 7. Sanity guards — stale quote / fat-finger limit-price deviation.
    const quote = await adapter.getQuote(intent.symbol);
    const quoteAgeMinutes = (Date.now() - new Date(quote.asOf).getTime()) / 60_000;
    if (quoteAgeMinutes > STALE_QUOTE_MINUTES) {
      return blocked(`quote for ${intent.symbol} is stale (${quoteAgeMinutes.toFixed(1)}m old)`);
    }
    if (intent.type === 'limit' && intent.limitPrice) {
      const deviationPct = (Math.abs(intent.limitPrice - quote.price) / quote.price) * 100;
      if (deviationPct > FAT_FINGER_PCT) {
        return blocked(`limit price $${intent.limitPrice} deviates ${deviationPct.toFixed(1)}% from quote $${quote.price} (fat-finger guard)`);
      }
    }

    return { allowed: true, reason: 'ok' };
  } catch (err) {
    const line = String(err).replace(/\s+/g, ' ').slice(0, 200);
    await hermesLog('error', `[RISK] gate crashed — failing closed: ${line}`);
    return blocked(`risk gate error (failing closed): ${line}`);
  }
}

function blocked(reason: string): RiskCheckResult {
  return { allowed: false, reason };
}

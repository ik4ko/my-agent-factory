// Research & Sync context gatherer — emits ONE compact markdown digest of
// local engine state for a terminal Claude session: live socket indicators
// (RSI/MACD computed in core/alpaca_feed.py), risk posture, caps, loops, and
// recent order audit rows. Brokerage data (positions / buying power) is
// deliberately NOT fetched here — this report is public-market research only;
// the /research-sync command merges it in after running this.
//   npx tsx scripts/research-sync.mts
import { config } from 'dotenv';
config({ path: '.env.local' });

import { getAdminClient } from '@/lib/supabase/admin';

const SOCKET_URL = process.env.NEXT_PUBLIC_AGENT_SOCKET_URL ?? 'ws://127.0.0.1:8765';
const COLLECT_MS = 5_000;

interface TickPayload {
  provider?: string;
  symbol?: string;
  price?: number;
  ts?: number;
  indicators?: {
    rsi: number | null;
    macd: number | null;
    macd_signal: number | null;
    macd_hist: number | null;
  };
}

/** Listen on the local agent socket for a few seconds and keep the latest
 *  market.tick per symbol. Resolves null when the bridge is down entirely. */
function collectIndicators(): Promise<Map<string, TickPayload> | null> {
  return new Promise((resolve) => {
    let socket: WebSocket;
    try {
      socket = new WebSocket(SOCKET_URL);
    } catch {
      resolve(null);
      return;
    }
    const latest = new Map<string, TickPayload>();
    const done = (value: Map<string, TickPayload> | null) => {
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      resolve(value);
    };
    const timer = setTimeout(() => done(latest.size > 0 ? latest : null), COLLECT_MS);
    socket.onerror = () => done(null);
    socket.onmessage = (message) => {
      try {
        const event = JSON.parse(String(message.data)) as { event?: string; payload?: TickPayload };
        if (event.event === 'market.tick' && event.payload?.symbol) {
          latest.set(event.payload.symbol, event.payload);
        }
      } catch {
        /* skip malformed frames */
      }
    };
  });
}

const fmt = (v: number | null | undefined, digits = 2): string =>
  typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—';

function envCap(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getAdminClient() as any;
  const [ticks, riskRes, loopsRes, ordersRes] = await Promise.all([
    collectIndicators(),
    db.from('risk_state').select('*').eq('id', 1).maybeSingle(),
    db.from('loops').select('name, kind, status, cadence_seconds').order('updated_at', { ascending: false }).limit(10),
    db
      .from('orders')
      .select('symbol, side, qty, notional, status, fill_price, reason, created_at')
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  const risk = riskRes.data ?? {};
  const overrides = (risk.symbol_overrides ?? {}) as Record<
    string,
    { blocked?: boolean; sizeMultiplier?: number; reason?: string }
  >;

  const lines: string[] = [];
  lines.push(`# Research & Sync — local engine digest (${new Date().toISOString()})`);
  lines.push('');
  lines.push('## Risk posture');
  lines.push(
    `- simulation_enabled: **${risk.trading_enabled}** (${risk.trading_enabled ? 'ARMED — paper orders enabled' : 'paper execution paused'})` +
      ` · kill_switch: ${risk.kill_switch} · halted: ${risk.halted}${risk.halt_reason ? ` — "${risk.halt_reason}"` : ''}`
  );
  lines.push(
    `- regime: **${risk.regime ?? 'NORMAL'}** · realized_pnl today: $${fmt(Number(risk.realized_pnl))} · feed_degraded: ${risk.feed_degraded}`
  );
  lines.push(
    `- caps (env, stricter-of with loop config): MAX_TRADE_USD=$${envCap('MAX_TRADE_USD', 250)} · ` +
      `DAILY_LOSS_LIMIT_USD=$${envCap('DAILY_LOSS_LIMIT_USD', 500)} · MAX_OPEN_POSITIONS=${envCap('MAX_OPEN_POSITIONS', 5)}`
  );
  const overrideLines = Object.entries(overrides).map(
    ([sym, o]) => `${sym} ${o.blocked ? 'BLOCKED' : `size×${o.sizeMultiplier ?? 1}`} (${o.reason ?? 'n/a'})`
  );
  lines.push(`- symbol overrides: ${overrideLines.length > 0 ? overrideLines.join(' · ') : 'none'}`);

  lines.push('');
  lines.push(`## Live indicators (${SOCKET_URL})`);
  if (!ticks) {
    lines.push('- socket offline — start it with `python -m core.runner` (hosts the bridge + Alpaca/mock feed)');
  } else {
    lines.push('| symbol | price | RSI(14) | MACD | signal | hist | provider | age |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const [symbol, tick] of [...ticks.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const age = tick.ts ? `${Math.round(Date.now() / 1000 - tick.ts)}s` : '—';
      const ind = tick.indicators;
      lines.push(
        `| ${symbol} | $${fmt(tick.price)} | ${fmt(ind?.rsi, 1)} | ${fmt(ind?.macd, 3)} | ${fmt(ind?.macd_signal, 3)} | ${fmt(
          ind?.macd_hist,
          3
        )} | ${tick.provider ?? '—'} | ${age} |`
      );
    }
  }

  lines.push('');
  lines.push('## Loops');
  for (const loop of loopsRes.data ?? []) {
    lines.push(`- [${loop.status}] ${loop.name} (${loop.kind}${loop.cadence_seconds ? `, ${loop.cadence_seconds}s` : ''})`);
  }

  lines.push('');
  lines.push('## Last 5 order audit rows');
  const orders = ordersRes.data ?? [];
  if (orders.length === 0) lines.push('- none');
  for (const o of orders) {
    const size = o.qty ? `${o.qty} sh` : o.notional ? `$${o.notional}` : '?';
    lines.push(
      `- ${o.created_at?.slice(0, 16)} ${o.side} ${o.symbol} ${size} → **${o.status}**${o.fill_price ? ` @ $${o.fill_price}` : ''}${
        o.reason ? ` (${String(o.reason).slice(0, 80)})` : ''
      }`
    );
  }

  console.log(lines.join('\n'));
}

main().catch((err) => {
  console.error('[research-sync] failed:', err);
  process.exit(1);
});

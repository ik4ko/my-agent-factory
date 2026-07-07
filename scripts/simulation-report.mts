// Dry-run simulation PnL report — replays every audited `orders` row with
// status='dry_run' against the CURRENT market quote and prints a markdown
// summary. Buys are marked long, sells short; rows sized by notional are
// converted to shares at their recorded fill price. Read-only: this script
// never writes anything anywhere.
//   npm run sim-report          (or: npx tsx scripts/simulation-report.mts)
import { config } from 'dotenv';
config({ path: '.env.local' });

import { getAdminClient } from '@/lib/supabase/admin';
import { getMarketContext } from '@/lib/market/fetcher';

interface DryRunOrder {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number | null;
  notional: number | null;
  fill_price: number | null;
  reason: string | null;
  created_at: string;
}

const usd = (v: number): string => `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`;
const pct = (v: number): string => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getAdminClient() as any;
  const { data, error } = await db
    .from('orders')
    .select('id, symbol, side, qty, notional, fill_price, reason, created_at')
    .eq('status', 'dry_run')
    .order('created_at', { ascending: true });
  if (error) throw new Error(`orders query failed: ${error.message}`);

  const orders = ((data ?? []) as DryRunOrder[]).filter((o) => o.fill_price && o.fill_price > 0);
  if (orders.length === 0) {
    console.log('# Dry-run simulation report\n\nNo dry_run orders with a recorded fill price yet.');
    return;
  }

  const symbols = [...new Set(orders.map((o) => o.symbol))];
  const quotes = new Map<string, { price: number; asOf: string; source: string }>();
  for (const symbol of symbols) {
    try {
      const ctx = await getMarketContext(symbol);
      quotes.set(symbol, { price: ctx.price, asOf: ctx.asOf, source: ctx.source });
    } catch {
      /* symbol excluded below with a note */
    }
  }

  interface Row {
    order: DryRunOrder;
    shares: number;
    entryNotional: number;
    pnl: number;
    ret: number;
  }
  const rows: Row[] = [];
  const skipped: DryRunOrder[] = [];
  for (const order of orders) {
    const quote = quotes.get(order.symbol);
    if (!quote) {
      skipped.push(order);
      continue;
    }
    const fill = order.fill_price as number;
    const shares = order.qty ?? (order.notional ? order.notional / fill : 0);
    if (shares <= 0) {
      skipped.push(order);
      continue;
    }
    const direction = order.side === 'buy' ? 1 : -1;
    const pnl = (quote.price - fill) * shares * direction;
    rows.push({ order, shares, entryNotional: fill * shares, pnl, ret: pnl / (fill * shares) });
  }

  const lines: string[] = [];
  lines.push(`# Dry-run simulation report (${new Date().toISOString()})`);
  lines.push('');
  lines.push(`${rows.length} simulated fill(s) marked to current quotes. Positions are hypothetical`);
  lines.push('audit rows — nothing here was ever placed at a broker.');
  lines.push('');
  lines.push('| filled (UTC) | symbol | side | shares | entry | now | notional | PnL | return | reason |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const { order, shares, entryNotional, pnl, ret } of rows) {
    const quote = quotes.get(order.symbol)!;
    lines.push(
      `| ${order.created_at.slice(0, 16)} | ${order.symbol} | ${order.side} | ${shares.toFixed(4)} | ` +
        `$${(order.fill_price as number).toFixed(2)} | $${quote.price.toFixed(2)} | ${usd(entryNotional)} | ` +
        `${usd(pnl)} | ${pct(ret)} | ${(order.reason ?? '').slice(0, 60)} |`
    );
  }

  lines.push('');
  lines.push('## Per-symbol');
  lines.push('| symbol | trades | notional | PnL | avg return | quote (source, as-of) |');
  lines.push('|---|---|---|---|---|---|');
  for (const symbol of symbols.filter((s) => quotes.has(s)).sort()) {
    const group = rows.filter((r) => r.order.symbol === symbol);
    if (group.length === 0) continue;
    const notional = group.reduce((sum, r) => sum + r.entryNotional, 0);
    const pnl = group.reduce((sum, r) => sum + r.pnl, 0);
    const avgRet = group.reduce((sum, r) => sum + r.ret, 0) / group.length;
    const quote = quotes.get(symbol)!;
    lines.push(
      `| ${symbol} | ${group.length} | ${usd(notional)} | ${usd(pnl)} | ${pct(avgRet)} | ` +
        `$${quote.price.toFixed(2)} (${quote.source}, ${quote.asOf.slice(0, 16)}) |`
    );
  }

  const totalNotional = rows.reduce((sum, r) => sum + r.entryNotional, 0);
  const totalPnl = rows.reduce((sum, r) => sum + r.pnl, 0);
  const wins = rows.filter((r) => r.pnl > 0).length;
  lines.push('');
  lines.push('## Totals');
  lines.push(`- simulated notional deployed: ${usd(totalNotional)} across ${rows.length} fill(s)`);
  lines.push(`- mark-to-market PnL: **${usd(totalPnl)}** (${pct(totalNotional > 0 ? totalPnl / totalNotional : 0)} on notional)`);
  lines.push(`- win rate at current marks: ${wins}/${rows.length}`);
  if (skipped.length > 0) {
    lines.push(`- skipped ${skipped.length} row(s): no live quote or no derivable share count`);
  }

  console.log(lines.join('\n'));
}

main().catch((err) => {
  console.error('[sim-report] failed:', err);
  process.exit(1);
});

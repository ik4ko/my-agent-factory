// Analytics room — dense, read-only telemetry rendered server-side from the
// same tables the engine writes: dry-run simulation PnL marked to live
// quotes, 24h model spend, and loop-engine throughput. No client state; a
// page refresh is the update cycle.
export const dynamic = 'force-dynamic';

import { WorkspaceScaffold } from '@/components/dashboard/workspace-scaffold';
import { getAdminClient } from '@/lib/supabase/admin';
import { getMarketContext } from '@/lib/market/fetcher';
import { summarizeSpend, shortModel } from '@/lib/telemetry/pricing';
import type { Metric } from '@/lib/types/database.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

interface DryRunOrder {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number | null;
  notional: number | null;
  fill_price: number | null;
  created_at: string;
}

const usd = (v: number) => `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`;
const pct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;

async function loadTelemetry() {
  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [ordersRes, metricsRes, runsRes, blockedRes] = await Promise.all([
    db().from('orders').select('id, symbol, side, qty, notional, fill_price, created_at').eq('status', 'dry_run').order('created_at', { ascending: true }),
    db().from('metrics').select('*').gte('created_at', dayAgo),
    db().from('loop_runs').select('id, status', { count: 'exact', head: false }).gte('started_at', dayAgo),
    db().from('orders').select('id', { count: 'exact', head: true }).eq('status', 'risk_blocked').gte('created_at', dayAgo),
  ]);

  const orders = ((ordersRes.data ?? []) as DryRunOrder[]).filter((o) => o.fill_price && o.fill_price > 0);
  const symbols = [...new Set(orders.map((o) => o.symbol))];
  const quotes = new Map<string, number>();
  await Promise.all(
    symbols.map(async (s) => {
      try {
        quotes.set(s, (await getMarketContext(s)).price);
      } catch {
        /* symbol skipped below */
      }
    })
  );

  const marks = orders.flatMap((o) => {
    const mark = quotes.get(o.symbol);
    const fill = o.fill_price as number;
    const shares = o.qty ?? (o.notional ? o.notional / fill : 0);
    if (!mark || shares <= 0) return [];
    const dir = o.side === 'buy' ? 1 : -1;
    const pnl = (mark - fill) * shares * dir;
    return [{ ...o, shares, mark, pnl, notionalIn: fill * shares }];
  });

  const runs = (runsRes.data ?? []) as { status: string }[];
  return {
    marks,
    spend: summarizeSpend((metricsRes.data ?? []) as Metric[]),
    loops24h: {
      total: runs.length,
      completed: runs.filter((r) => r.status === 'completed').length,
      failed: runs.filter((r) => r.status === 'failed').length,
    },
    blocked24h: blockedRes.count ?? 0,
  };
}

export default async function AnalyticsRoom() {
  const { marks, spend, loops24h, blocked24h } = await loadTelemetry();
  const totalPnl = marks.reduce((s, m) => s + m.pnl, 0);
  const totalNotional = marks.reduce((s, m) => s + m.notionalIn, 0);
  const wins = marks.filter((m) => m.pnl > 0).length;
  const perModel = Object.entries(spend.byModel).filter(([, v]) => v.tokens > 0).sort((a, b) => b[1].tokens - a[1].tokens);

  return (
    <WorkspaceScaffold
      title="Analytics Room"
      icon="activity"
      accent="text-neon-orange"
      blurb="Deep telemetry, rendered dense and read-only: dry-run simulation PnL marked against live quotes, 24h model spend, and loop-engine throughput. Everything here is derived from the audit tables — refresh for a new mark."
    >
      <div className="flex max-w-3xl flex-col gap-5 font-terminal">
        <section>
          <h2 className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
            Dry-run simulation PnL — marked to current quotes
          </h2>
          {marks.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-3 text-[10px] text-muted-foreground/40">
              No dry-run fills with a live quote to mark against yet.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="border-b border-border bg-surface-1/60 text-left text-[9px] uppercase tracking-wider text-muted-foreground/50">
                      <th className="px-2.5 py-1.5 font-medium">filled</th>
                      <th className="px-2.5 py-1.5 font-medium">symbol</th>
                      <th className="px-2.5 py-1.5 font-medium">side</th>
                      <th className="px-2.5 py-1.5 font-medium">entry</th>
                      <th className="px-2.5 py-1.5 font-medium">mark</th>
                      <th className="px-2.5 py-1.5 font-medium">PnL</th>
                      <th className="px-2.5 py-1.5 font-medium">return</th>
                    </tr>
                  </thead>
                  <tbody>
                    {marks.map((m) => (
                      <tr key={m.id} className="border-b border-border/40 last:border-b-0">
                        <td className="px-2.5 py-1 tabular text-muted-foreground/50">{m.created_at.slice(0, 16)}</td>
                        <td className="px-2.5 py-1 font-semibold text-foreground/85">{m.symbol}</td>
                        <td className="px-2.5 py-1 text-muted-foreground/60">{m.side}</td>
                        <td className="px-2.5 py-1 tabular">${(m.fill_price as number).toFixed(2)}</td>
                        <td className="px-2.5 py-1 tabular">${m.mark.toFixed(2)}</td>
                        <td className={m.pnl >= 0 ? 'px-2.5 py-1 tabular text-neon-green' : 'px-2.5 py-1 tabular text-neon-red'}>{usd(m.pnl)}</td>
                        <td className={m.pnl >= 0 ? 'px-2.5 py-1 tabular text-neon-green/70' : 'px-2.5 py-1 tabular text-neon-red/70'}>
                          {pct(m.notionalIn > 0 ? m.pnl / m.notionalIn : 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground/60">
                {marks.length} simulated fill(s) · {usd(totalNotional)} notional · mark-to-market{' '}
                <span className={totalPnl >= 0 ? 'text-neon-green' : 'text-neon-red'}>{usd(totalPnl)}</span> · win rate{' '}
                {wins}/{marks.length}. Hypothetical audit rows — nothing was placed at a broker.
              </p>
            </>
          )}
        </section>

        <section>
          <h2 className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Model spend — last 24h</h2>
          <p className="text-[10px] text-muted-foreground/70">
            {spend.totalTokens.toLocaleString()} tokens · est {usd(spend.totalCostUsd)} · Fable share {(spend.fableShare * 100).toFixed(1)}%
          </p>
          {perModel.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {perModel.map(([model, v]) => (
                <span key={model} className="rounded border border-border bg-surface-1 px-1.5 py-0.5 text-[10px] text-muted-foreground/70">
                  {shortModel(model)} · {v.tokens.toLocaleString()} tok
                </span>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Loop engine — last 24h</h2>
          <p className="text-[10px] text-muted-foreground/70">
            {loops24h.total} run(s) · {loops24h.completed} completed · {loops24h.failed} failed · {blocked24h} order intent(s)
            risk-blocked
          </p>
        </section>
      </div>
    </WorkspaceScaffold>
  );
}

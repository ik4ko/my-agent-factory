'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { METRICS_KEY } from '@/hooks/use-metrics-query';
import { summarizeSpend, shortModel } from '@/lib/telemetry/pricing';
import type { Metric } from '@/lib/types/database.types';

/**
 * Live per-lane token + USD stream, computed from the shared 24h metrics
 * cache (owned by MetricsBar's realtime subscription on the dashboard). This
 * is the Analytics token-stream engine, folded into the Main matrix view and
 * reused by the Spatial analytics overlay. Passive cache read — no second
 * subscription.
 */
export function TokenStream() {
  const { data: metrics = [] } = useQuery<Metric[]>({ queryKey: METRICS_KEY, queryFn: async () => [], enabled: false, initialData: [] });
  const spend = useMemo(() => summarizeSpend(metrics), [metrics]);

  const lanes = useMemo(() => {
    const io = new Map<string, { input: number; output: number }>();
    for (const m of metrics) {
      const e = io.get(m.model) ?? { input: 0, output: 0 };
      e.input += m.input_tokens ?? 0;
      e.output += m.output_tokens ?? 0;
      io.set(m.model, e);
    }
    return Object.entries(spend.byModel)
      .map(([model, v]) => ({ model, tokens: v.tokens, costUsd: v.costUsd, ...(io.get(model) ?? { input: 0, output: 0 }) }))
      .filter((l) => l.tokens > 0)
      .sort((a, b) => b.tokens - a.tokens);
  }, [metrics, spend]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Token stream · 24h per lane</span>
        <span className="rounded border border-neon-orange/40 px-1.5 py-px font-terminal text-[9px] text-neon-orange/80">DRY-RUN · est USD</span>
      </div>
      {lanes.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/50 p-3 font-terminal text-[10px] text-muted-foreground/40">
          No model calls in the last 24h — dispatch from the Orchestrate pane or command dock to populate the stream.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-auto rounded-md border border-border/50">
          <table className="w-full font-terminal text-[10px]">
            <thead>
              <tr className="border-b border-border/50 bg-surface-1/40 text-left text-[9px] uppercase tracking-wider text-muted-foreground/50">
                <th className="px-2 py-1 font-medium">model lane</th>
                <th className="px-2 py-1 font-medium">in</th>
                <th className="px-2 py-1 font-medium">out</th>
                <th className="px-2 py-1 font-medium">total</th>
                <th className="px-2 py-1 font-medium">est USD</th>
              </tr>
            </thead>
            <tbody>
              {lanes.map((l) => (
                <tr key={l.model} className="border-b border-border/30 last:border-b-0">
                  <td className="px-2 py-1 text-foreground/85">{shortModel(l.model)}</td>
                  <td className="px-2 py-1 tabular text-muted-foreground/60">{l.input.toLocaleString()}</td>
                  <td className="px-2 py-1 tabular text-muted-foreground/60">{l.output.toLocaleString()}</td>
                  <td className="px-2 py-1 tabular text-neon-cyan/90">{l.tokens.toLocaleString()}</td>
                  <td className="px-2 py-1 tabular text-neon-green">${l.costUsd.toFixed(l.costUsd >= 1 ? 2 : 4)}</td>
                </tr>
              ))}
              <tr className="bg-surface-1/30">
                <td className="px-2 py-1 font-semibold text-foreground/70">total</td>
                <td className="px-2 py-1" />
                <td className="px-2 py-1" />
                <td className="px-2 py-1 tabular font-semibold text-neon-cyan">{spend.totalTokens.toLocaleString()}</td>
                <td className="px-2 py-1 tabular font-semibold text-neon-green">${spend.totalCostUsd.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

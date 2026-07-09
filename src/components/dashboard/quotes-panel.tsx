'use client';

import { LineChart } from 'lucide-react';
import { useQuotesQuery } from '@/hooks/use-quotes-query';
import { cn } from '@/lib/utils';

/** Live Finnhub-backed quotes for the symbol allowlist, polled by the loop
 *  worker every QUOTE_POLL_MS and streamed here via Supabase Realtime. This
 *  is a read-only display — the risk gate still sizes orders off
 *  getMarketContext()'s Yahoo-backed path, unchanged.
 *
 *  Reskinned to the Instrument Deck quotes ticker (Trading Room.dc.html
 *  §Quotes): a horizontal SIM-tagged strip of symbol · price · delta cells. */
export function QuotesPanel() {
  const { data: quotes = [], isLoading } = useQuotesQuery();

  return (
    <div className="flex min-h-[34px] items-stretch overflow-x-auto rounded-[6px] border border-border/90 bg-surface-deep">
      <div className="flex flex-shrink-0 items-center gap-[7px] border-r border-border/60 px-[13px]">
        <LineChart className="size-3 text-primary" aria-hidden />
        <span className="font-mono text-[8px] tracking-[0.16em] text-[#4c6079]">QUOTES</span>
        <span className="rounded-[2px] border border-warning/40 px-[5px] font-mono text-[7.5px] font-bold text-warning">
          SIM
        </span>
      </div>

      {isLoading ? (
        <span className="flex items-center px-4 font-mono text-[10px] text-ink-mid">Loading quotes…</span>
      ) : quotes.length === 0 ? (
        <span className="flex items-center px-4 font-mono text-[10px] text-ink-low">
          No quotes cached — run the loop worker (npm run loop-worker) to poll the allowlist.
        </span>
      ) : (
        quotes.map((q) => {
          const up = (q.change_pct ?? 0) >= 0;
          return (
            <div
              key={q.symbol}
              className="flex flex-shrink-0 items-center gap-2 border-r border-border/30 px-[15px]"
              title={`${q.source} · ${q.symbol}`}
            >
              <span className="font-mono text-[10px] font-bold text-[#cdd9e8]">{q.symbol}</span>
              <span className="tabular font-mono text-[10.5px] text-ink-mid">${q.price.toFixed(2)}</span>
              <span className={cn('tabular font-mono text-[9px] font-semibold', up ? 'text-neon-green' : 'text-destructive')}>
                {up ? '+' : ''}
                {q.change_pct?.toFixed(2) ?? '0.00'}%
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}

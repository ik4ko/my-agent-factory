'use client';

import { useQuotesQuery } from '@/hooks/use-quotes-query';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

/** Live Finnhub-backed quotes for the symbol allowlist, polled by the loop
 *  worker every QUOTE_POLL_MS and streamed here via Supabase Realtime. This
 *  is a read-only display — the risk gate still sizes orders off
 *  getMarketContext()'s Yahoo-backed path, unchanged. */
export function QuotesPanel() {
  const { data: quotes = [], isLoading } = useQuotesQuery();

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading quotes…</p>;
  if (quotes.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">
        No quotes cached yet — the loop worker polls Finnhub for the symbol allowlist once it&apos;s running (
        <code className="font-terminal">npm run loop-worker</code>).
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {quotes.map((q) => {
        const up = (q.change_pct ?? 0) >= 0;
        return (
          <div key={q.symbol} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-medium">{q.symbol}</span>
              <Badge variant="muted">{q.source}</Badge>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-terminal">${q.price.toFixed(2)}</span>
              <span className={cn('font-terminal text-xs', up ? 'text-neon-green' : 'text-neon-red')}>
                {up ? '+' : ''}
                {q.change_pct?.toFixed(2) ?? '0.00'}%
              </span>
              <span className="text-[10px] text-muted-foreground/60">{relativeTime(q.updated_at)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

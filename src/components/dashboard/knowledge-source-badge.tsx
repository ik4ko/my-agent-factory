'use client';

import { BookOpenText } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';

const NEWS_FRESH_MS = 60 * 60_000;

/**
 * Research Room trust guard — same priority as the trading simulation
 * banner. The agents have NO live web access; this badge is persistent and
 * data-aware: it checks whether cached news events are fresh and states
 * exactly what the reasoning is grounded in, so a findings feed can never
 * pass off trained-knowledge output as live-web research.
 */
export function KnowledgeSourceBadge() {
  const { data: freshNews = 0 } = useQuery({
    queryKey: ['events', 'fresh-news-count'],
    queryFn: async () => {
      const cutoff = new Date(Date.now() - NEWS_FRESH_MS).toISOString();
      const { count, error } = await createClient()
        .from('events')
        .select('id', { count: 'exact', head: true })
        .eq('type', 'news')
        .gte('created_at', cutoff);
      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 60_000,
    staleTime: 50_000,
  });

  const detail =
    freshNews > 0
      ? `trained knowledge + ${freshNews} cached news event(s) from the last hour — no live web browsing`
      : 'trained knowledge only — no live web or news feed connected';

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex shrink-0 items-center justify-center gap-2 rounded-md border border-neon-purple/50 bg-neon-purple/10 px-3 py-1"
    >
      <BookOpenText className="size-3 shrink-0 text-neon-purple" aria-hidden />
      <span className="font-terminal text-[11px] font-bold uppercase tracking-[0.15em] text-neon-purple">
        Reasoning from trained knowledge — not live web
      </span>
      <span className="hidden truncate font-terminal text-[10px] text-neon-purple/70 sm:block" title={detail}>
        · {detail}
      </span>
    </div>
  );
}

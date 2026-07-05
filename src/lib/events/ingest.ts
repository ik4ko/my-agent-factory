// News ingest orchestrator — deterministic glue between the feed, the
// classifier, and the regime controller. Division of labor: CODE here does
// every HTTP call, every dedupe check, and every DB mutation. The ONLY LLM
// call in this whole pipeline is inside classify.ts, and it returns nothing
// but a strict-JSON classification — it never touches risk_state directly.
import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { FinnhubFeed } from './news/finnhub';
import { classifyHeadline } from './classify';
import { runRegimeController, markFeedDegraded, markFeedRecovered } from './regime';
import type { NewsFeed } from './news/types';
import type { RegimeResult } from './regime';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

const DEDUPE_WINDOW_MS = 24 * 60 * 60_000;

const feed: NewsFeed = new FinnhubFeed();

async function alreadySeen(url: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
  const { data } = await db()
    .from('events')
    .select('id')
    .eq('type', 'news')
    .gte('created_at', cutoff)
    .eq('payload->>url', url)
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

export interface IngestResult {
  fetched: number;
  inserted: number;
  degraded: boolean;
  regime: RegimeResult;
}

/** One full cycle: fetch → dedupe → classify → insert `events` → run the
 *  regime controller. Never throws — a feed/classifier failure degrades the
 *  system (fail-closed) instead of crashing the worker. */
export async function runNewsIngestCycle(): Promise<IngestResult> {
  const result = await feed.fetchHeadlines();

  if (!result.ok) {
    await markFeedDegraded(result.reason);
    const regime = await runRegimeController();
    return { fetched: 0, inserted: 0, degraded: true, regime };
  }
  await markFeedRecovered();

  let inserted = 0;
  for (const headline of result.headlines) {
    try {
      if (await alreadySeen(headline.url)) continue;

      const classification = await classifyHeadline(headline);
      if (!classification.actionable) continue;

      const symbol = classification.symbols[0] ?? headline.symbol ?? null;
      await db().from('events').insert({
        type: 'news',
        symbol,
        severity: classification.severity,
        payload: {
          sentiment: classification.sentiment,
          event_type: classification.event_type,
          source: headline.source,
          url: headline.url,
          headline: headline.headline,
          rationale: classification.rationale,
          actionable: classification.actionable,
          symbols: classification.symbols,
        },
      });
      inserted++;
    } catch (err) {
      await hermesLog('error', `[NEWS] failed to process headline "${headline.headline.slice(0, 60)}": ${String(err).replace(/\s+/g, ' ').slice(0, 160)}`);
    }
  }

  const regime = await runRegimeController();
  if (inserted > 0) {
    await hermesLog('info', `[NEWS] ingested ${inserted}/${result.headlines.length} headlines as actionable events — regime=${regime.regime}`);
  }
  return { fetched: result.headlines.length, inserted, degraded: false, regime };
}

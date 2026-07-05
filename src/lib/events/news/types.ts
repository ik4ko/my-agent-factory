// NewsFeed — pluggable provider contract. FinnhubFeed (finnhub.ts) is the
// only implementation today; keep the shape provider-agnostic so a second
// feed can be added without touching ingest.ts or classify.ts.
export interface Headline {
  /** Provider-native id — used for de-duplication alongside url. */
  id: string;
  url: string;
  headline: string;
  summary: string;
  source: string;
  /** ISO timestamp. */
  datetime: string;
  /** Ticker this headline is already scoped to (company-news), if any. */
  symbol: string | null;
}

export type FeedResult = { ok: true; headlines: Headline[] } | { ok: false; reason: string; retriable: boolean };

export interface NewsFeed {
  fetchHeadlines(): Promise<FeedResult>;
}

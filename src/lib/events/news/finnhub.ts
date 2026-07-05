// FinnhubFeed — company-news per allowlist symbol + general market news.
// All HTTP + dedupe + backoff lives here in deterministic code; nothing in
// this file calls an LLM (see the module-level division of labor note in
// src/lib/events/ingest.ts).
import type { FeedResult, Headline, NewsFeed } from './types';

const BASE_URL = 'https://finnhub.io/api/v1';
const TIMEOUT_MS = 8_000;
const MAX_BACKOFF_MS = 10 * 60_000;

function allowlistSymbols(): string[] {
  const raw = process.env.SYMBOL_ALLOWLIST?.trim();
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

interface FinnhubArticle {
  id: number;
  headline: string;
  summary: string;
  source: string;
  url: string;
  datetime: number; // unix seconds
  related?: string;
}

function toHeadline(a: FinnhubArticle, fallbackSymbol: string | null): Headline | null {
  if (!a.headline || !a.url) return null;
  return {
    id: String(a.id ?? a.url),
    url: a.url,
    headline: a.headline,
    summary: a.summary ?? '',
    source: a.source ?? 'finnhub',
    datetime: new Date((a.datetime ?? Date.now() / 1000) * 1000).toISOString(),
    symbol: (a.related?.split(',')[0]?.trim() || fallbackSymbol || null),
  };
}

export class FinnhubFeed implements NewsFeed {
  private consecutiveFailures = 0;
  private backoffUntil = 0;

  private async getJson(path: string): Promise<unknown[]> {
    const key = process.env.FINNHUB_API_KEY?.trim();
    if (!key) throw Object.assign(new Error('FINNHUB_API_KEY not set'), { retriable: false });

    const url = `${BASE_URL}${path}${path.includes('?') ? '&' : '?'}token=${key}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 429 || res.status >= 500) {
      throw Object.assign(new Error(`finnhub ${res.status}`), { retriable: true });
    }
    if (!res.ok) {
      throw Object.assign(new Error(`finnhub ${res.status}: ${(await res.text()).slice(0, 160)}`), { retriable: false });
    }
    const json = await res.json();
    return Array.isArray(json) ? json : [];
  }

  async fetchHeadlines(): Promise<FeedResult> {
    if (Date.now() < this.backoffUntil) {
      return { ok: false, reason: `backing off until ${new Date(this.backoffUntil).toISOString()}`, retriable: true };
    }

    try {
      const symbols = allowlistSymbols();
      const day = todayYmd();
      const headlines: Headline[] = [];

      const general = await this.getJson('/news?category=general');
      for (const raw of general as FinnhubArticle[]) {
        const h = toHeadline(raw, null);
        if (h) headlines.push(h);
      }

      for (const symbol of symbols) {
        const articles = await this.getJson(`/company-news?symbol=${encodeURIComponent(symbol)}&from=${day}&to=${day}`);
        for (const raw of articles as FinnhubArticle[]) {
          const h = toHeadline(raw, symbol);
          if (h) headlines.push(h);
        }
      }

      this.consecutiveFailures = 0;
      this.backoffUntil = 0;
      return { ok: true, headlines };
    } catch (err) {
      const retriable = (err as { retriable?: boolean })?.retriable !== false;
      this.consecutiveFailures++;
      if (retriable) {
        const backoffMs = Math.min(MAX_BACKOFF_MS, 2 ** this.consecutiveFailures * 1000);
        this.backoffUntil = Date.now() + backoffMs;
      }
      return { ok: false, reason: String(err instanceof Error ? err.message : err).slice(0, 200), retriable };
    }
  }
}

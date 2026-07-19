/**
 * Live-data tools — the ONE shared tool layer every lane uses (same
 * single-resolution instinct as backend-config.ts). Three read-only tools:
 *
 *   web_search      Tavily (TAVILY_API_KEY — free tier ~1k req/mo). Without
 *                   the key the tool still exists but returns a plain
 *                   "not configured" message the model can relay.
 *   get_weather     Open-Meteo geocoding + forecast. No API key, free.
 *   get_stock_quote yahoo-finance2 (already a dependency). No API key, no
 *                   broker auth — pure public read, safe for every lane.
 *
 * Contract: executeLiveTool NEVER throws and NEVER hangs (8s timeout per
 * call) — a failed lookup degrades to an error string the model reads and
 * works around, so a dead data API can't break a conversation turn.
 * Results live only inside the in-flight request's message array: nothing
 * here writes history or life-context, so mentor-lane isolation and the
 * life-context confirm gate are untouched by design.
 */

import { recordFeedbackEvent } from '@/lib/telemetry/feedback-ledger';
import { consumeToolBudget } from './tool-budget';

const TOOL_TIMEOUT_MS = 8_000;
const MAX_RESULT_CHARS = 4_000;
const TOOL_CACHE_TTL_MS = 45_000;
const TOOL_RESULT_CACHE = new Map<string, { value: string; expiresAt: number }>();

export interface LiveTool {
  name: string;
  description: string;
  /** JSON Schema for the arguments (shared by both provider formats). */
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  execute(args: Record<string, unknown>): Promise<string>;
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TOOL_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/** Bound libraries that do not accept AbortSignal (notably yahoo-finance2).
 * The underlying promise may finish later, but callers regain control at the
 * same hard deadline as fetch-based tools. */
export async function withToolTimeout<T>(operation: Promise<T>, label: string, timeoutMs = TOOL_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const webSearch: LiveTool = {
  name: 'web_search',
  description: 'Search the live web for current news, facts, and general information. Returns top results with titles, URLs, and snippets.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query' },
      max_results: { type: 'number', description: 'How many results (1-8, default 5)' },
    },
    required: ['query'],
  },
  async execute(args) {
    const apiKey = process.env.TAVILY_API_KEY?.trim();
    if (!apiKey) return 'Web search is not configured on this system (TAVILY_API_KEY is missing). Tell the operator to add a Tavily API key to enable live search.';
    const query = String(args.query ?? '').slice(0, 400);
    if (!query) return 'Web search failed: empty query.';
    const maxResults = Math.max(1, Math.min(8, Number(args.max_results) || 5));
    const data = (await fetchJson('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults, include_answer: true }),
    })) as { answer?: string; results?: Array<{ title?: string; url?: string; content?: string }> };
    const lines = [
      ...(data.answer ? [`Answer summary: ${data.answer}`] : []),
      ...(data.results ?? []).map((r, i) => `${i + 1}. ${r.title ?? 'untitled'} — ${r.url ?? ''}\n${(r.content ?? '').slice(0, 300)}`),
    ];
    return lines.length ? lines.join('\n\n') : 'No results found.';
  },
};

const getWeather: LiveTool = {
  name: 'get_weather',
  description: 'Get current weather and a short forecast for a city or place name.',
  inputSchema: {
    type: 'object',
    properties: { location: { type: 'string', description: 'City or place name, e.g. "Austin, TX"' } },
    required: ['location'],
  },
  async execute(args) {
    const location = String(args.location ?? '').slice(0, 120);
    if (!location) return 'Weather lookup failed: empty location.';
    const geo = (await fetchJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`,
    )) as { results?: Array<{ latitude: number; longitude: number; name: string; admin1?: string; country?: string }> };
    const place = geo.results?.[0];
    if (!place) return `Weather lookup failed: could not find a place named "${location}".`;
    const wx = (await fetchJson(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
        '&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code' +
        '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=3&timezone=auto',
    )) as {
      current?: { temperature_2m?: number; apparent_temperature?: number; relative_humidity_2m?: number; wind_speed_10m?: number };
      daily?: { time?: string[]; temperature_2m_max?: number[]; temperature_2m_min?: number[]; precipitation_probability_max?: number[] };
    };
    const c = wx.current ?? {};
    const days = (wx.daily?.time ?? []).map((day, i) =>
      `${day}: ${wx.daily?.temperature_2m_min?.[i]}–${wx.daily?.temperature_2m_max?.[i]}°C, precip ${wx.daily?.precipitation_probability_max?.[i] ?? '?'}%`,
    );
    return [
      `Weather for ${place.name}${place.admin1 ? `, ${place.admin1}` : ''}${place.country ? `, ${place.country}` : ''}:`,
      `Now: ${c.temperature_2m}°C (feels ${c.apparent_temperature}°C), humidity ${c.relative_humidity_2m}%, wind ${c.wind_speed_10m} km/h.`,
      ...days,
    ].join('\n');
  },
};

const getStockQuote: LiveTool = {
  name: 'get_stock_quote',
  description: 'Get a live public market quote for a stock/ETF ticker (price, change, day range, volume). Read-only public data — no orders, no account access.',
  inputSchema: {
    type: 'object',
    properties: { symbol: { type: 'string', description: 'Ticker symbol, e.g. NVDA' } },
    required: ['symbol'],
  },
  async execute(args) {
    const symbol = String(args.symbol ?? '').trim().toUpperCase().slice(0, 10);
    if (!symbol) return 'Quote lookup failed: empty symbol.';
    // Lazy import: yahoo-finance2 is heavyweight and server-only. v3 exports
    // a class (verified live 2026-07-19 — the v2 singleton style throws).
    // quote()'s overloads collapse to `never` under our tsconfig — cast to
    // the fields we read (same data the /api/market/quotes route consumes).
    const q = await withToolTimeout((async () => {
      const { default: YahooFinance } = await import('yahoo-finance2');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const yahooFinance = new (YahooFinance as any)({ suppressNotices: ['yahooSurvey'] });
      return yahooFinance.quote(symbol);
    })(), `Yahoo quote for ${symbol}`) as unknown as {
      symbol?: string;
      shortName?: string;
      regularMarketPrice?: number;
      regularMarketChange?: number;
      regularMarketChangePercent?: number;
      regularMarketDayLow?: number;
      regularMarketDayHigh?: number;
      regularMarketVolume?: number;
      marketState?: string;
    };
    if (!q?.regularMarketPrice) return `Quote lookup failed: no data for "${symbol}".`;
    return [
      `${q.symbol} (${q.shortName ?? 'unknown'}): $${q.regularMarketPrice}`,
      `Change: ${q.regularMarketChange?.toFixed(2)} (${q.regularMarketChangePercent?.toFixed(2)}%)`,
      `Day range: ${q.regularMarketDayLow}–${q.regularMarketDayHigh} · Volume: ${q.regularMarketVolume}`,
      `Market state: ${q.marketState ?? 'unknown'} · As of live Yahoo Finance public data.`,
    ].join('\n');
  },
};

const REGISTRY = new Map<string, LiveTool>([
  [webSearch.name, webSearch],
  [getWeather.name, getWeather],
  [getStockQuote.name, getStockQuote],
]);

export function listLiveTools(): LiveTool[] {
  return [...REGISTRY.values()];
}

/** TEST-ONLY: swap a tool implementation; returns a restore function. */
export function __setLiveToolForTest(tool: LiveTool): () => void {
  TOOL_RESULT_CACHE.clear();
  const previous = REGISTRY.get(tool.name);
  REGISTRY.set(tool.name, tool);
  return () => {
    if (previous) REGISTRY.set(tool.name, previous);
    else REGISTRY.delete(tool.name);
  };
}

/** Anthropic Messages API tool format. */
export function toAnthropicTools() {
  return listLiveTools().map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
}

/** OpenAI chat-completions tool format (OpenRouter, local servers, NVIDIA). */
export function toOpenAITools() {
  return listLiveTools().map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

/** OpenAI RESPONSES API tool format (flat, not nested under `function`). */
export function toOpenAIResponsesTools() {
  return listLiveTools().map((t) => ({
    type: 'function' as const,
    name: t.name,
    description: t.description,
    parameters: t.inputSchema as unknown as Record<string, unknown>,
    strict: false,
  }));
}

/** Execute a tool call. Never throws; never exceeds the timeout by much;
 *  always returns a string the model can read. Budget-gated per call
 *  (tool-budget.ts) and recorded to the feedback ledger for observability. */
export async function executeLiveTool(name: string, args: Record<string, unknown>): Promise<string> {
  const tool = REGISTRY.get(name);
  if (!tool) return `Tool "${name}" does not exist. Available: ${listLiveTools().map((t) => t.name).join(', ')}.`;
  const cacheKey = `${name}:${stableArgs(args ?? {})}`;
  const cached = TOOL_RESULT_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    recordToolCall(name, 'ok', 0);
    return cached.value;
  }
  if (cached) TOOL_RESULT_CACHE.delete(cacheKey);
  const denial = await consumeToolBudget();
  if (denial) return denial;
  const started = Date.now();
  try {
    const result = await tool.execute(args ?? {});
    recordToolCall(name, 'ok', Date.now() - started);
    const bounded = result.slice(0, MAX_RESULT_CHARS);
    TOOL_RESULT_CACHE.set(cacheKey, { value: bounded, expiresAt: Date.now() + TOOL_CACHE_TTL_MS });
    return bounded;
  } catch (err) {
    recordToolCall(name, 'error', Date.now() - started);
    return `Tool "${name}" failed: ${err instanceof Error ? err.message : 'unknown error'}. Reply using what you already know and mention the lookup failed.`;
  }
}

function stableArgs(args: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(args).sort().map((key) => [key, args[key]]));
}

function recordToolCall(name: string, outcome: 'ok' | 'error', latencyMs: number): void {
  void recordFeedbackEvent({ kind: 'tool_call', userAction: name, note: outcome, latencyMs });
}

export function parseToolArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

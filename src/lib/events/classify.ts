// Headline classifier — the ONLY place an LLM touches the news pipeline.
// One job: turn a cleaned headline into strict JSON (BLOCK A from the spec).
// No HTTP calls, no DB mutations happen here — see ingest.ts for the
// deterministic orchestration and regime.ts for the deterministic state
// mutations. Any parse or model failure fails CLOSED (severity:'critical',
// actionable:true) — an ambiguous headline is treated as the worst case,
// never waved through as benign.
import { z } from 'zod';
import { AgentRegistry } from '@/lib/agents/registry';
import type { Headline } from './news/types';

const ClassificationSchema = z.object({
  symbols: z.array(z.string().trim().toUpperCase().regex(/^[A-Z.]{1,6}$/)).max(10),
  sentiment: z.number().min(-1).max(1),
  severity: z.enum(['low', 'med', 'high', 'critical']),
  event_type: z.enum(['earnings', 'guidance', 'macro', 'regulatory', 'mna', 'litigation', 'product', 'other']),
  actionable: z.boolean(),
  rationale: z.string().max(200),
});
export type Classification = z.infer<typeof ClassificationSchema>;

const SYSTEM_PROMPT = `You classify a single financial news headline. Reply with ONLY one JSON object, no markdown fence, no preamble, no trailing text:
{"symbols":["NVDA"],"sentiment":-0.82,"severity":"low|med|high|critical","event_type":"earnings|guidance|macro|regulatory|mna|litigation|product|other","actionable":true,"rationale":"<=120 chars, deterministic"}
symbols: uppercase tickers mentioned or clearly implied (empty array if none). sentiment: -1 (very bearish) to 1 (very bullish). severity: how much this could move price/risk NOW. actionable: true only if a trading loop should react to it right now.`;

function cleanHeadline(h: Headline): string {
  return `${h.headline}${h.summary ? ` — ${h.summary}` : ''}`.replace(/\s+/g, ' ').trim().slice(0, 600);
}

function failClosed(rationale: string, symbol: string | null): Classification {
  return {
    symbols: symbol ? [symbol] : [],
    sentiment: -1,
    severity: 'critical',
    event_type: 'other',
    actionable: true,
    rationale: rationale.slice(0, 200),
  };
}

function extractJson(text: string): unknown | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export async function classifyHeadline(headline: Headline): Promise<Classification> {
  try {
    const thought = await AgentRegistry.HERMES.think({
      system: SYSTEM_PROMPT,
      prompt: cleanHeadline(headline),
      maxTokens: 200,
    });
    const json = extractJson(thought.text);
    if (json === null) return failClosed(`classifier returned unparseable output: "${thought.text.slice(0, 80)}"`, headline.symbol);

    const parsed = ClassificationSchema.safeParse(json);
    if (!parsed.success) return failClosed(`classifier output failed schema validation`, headline.symbol);

    return parsed.data;
  } catch (err) {
    return failClosed(`classifier error: ${String(err).replace(/\s+/g, ' ').slice(0, 120)}`, headline.symbol);
  }
}

import Anthropic from '@anthropic-ai/sdk';
import type { AgentProvider, FederatedAgent, ThinkInput, ThinkResult } from './types';
import type { AgentType } from '@/lib/types/database.types';

/**
 * AgentRegistry — the Federated Brain Network.
 *
 * Three GENUINELY DISTINCT brains, each a different upstream model, routed
 * through OpenRouter's OpenAI-compatible API with a single OPENROUTER_API_KEY:
 *
 *   CLAUDE  (CEO)     → anthropic/claude-3.5-sonnet   — the boss; triages
 *                       intent and delegates to the helpers.
 *   CODEX   (helper)  → openai/gpt-4o-mini            — code / quant analysis.
 *   HERMES  (helper)  → nousresearch/hermes-3-llama-3.1-70b — research / recon.
 *
 * Degradation contract: if OPENROUTER_API_KEY is absent or a call fails, the
 * brain FALLS BACK to the direct Anthropic SDK adapter and reports that in the
 * ThinkResult (provider/model say what actually ran). Note: with no OpenRouter
 * key, all three collapse to the Anthropic fallback and behave IDENTICALLY —
 * set OPENROUTER_API_KEY to make them truly independent.
 *
 * Lane-router overrides (Anthropic model IDs like 'claude-haiku-4-5') bind
 * directly to the Anthropic adapter — those IDs are not OpenRouter slugs.
 */

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_HEADERS: Record<string, string> = {
  'HTTP-Referer': 'http://localhost:9002',
  'X-Title': 'My Agent Factory',
  'X-OpenRouter-Title': 'My Agent Factory',
};

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

async function anthropicThink(model: string, input: ThinkInput): Promise<ThinkResult> {
  const started = Date.now();
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;

  const stream = await getAnthropic().messages.create({
    model,
    max_tokens: input.maxTokens ?? 2048,
    system: input.system,
    messages: [{ role: 'user', content: input.prompt }],
    stream: true,
  });

  for await (const event of stream) {
    if (event.type === 'message_start') {
      inputTokens = event.message.usage?.input_tokens ?? 0;
    } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      text += event.delta.text;
      input.onDelta?.(event.delta.text);
    } else if (event.type === 'message_delta') {
      outputTokens = event.usage?.output_tokens ?? outputTokens;
    }
  }

  return { text: text.trim(), model, provider: 'anthropic', inputTokens, outputTokens, latencyMs: Date.now() - started };
}

interface OpenAICompatibleConfig {
  provider: Exclude<AgentProvider, 'anthropic'>;
  baseUrl: string;
  keyEnv: string;
  model: string;
  headers?: Record<string, string>;
}

async function openAICompatibleThink(cfg: OpenAICompatibleConfig, input: ThinkInput): Promise<ThinkResult> {
  const started = Date.now();
  const key = process.env[cfg.keyEnv]?.trim();
  if (!key) throw new Error(`${cfg.keyEnv} not configured`);

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...(cfg.headers ?? {}) },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: input.maxTokens ?? 2048,
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`${cfg.provider} responded ${res.status}: ${(await res.text()).slice(0, 120)}`);

  const json: unknown = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = json as any;
  const text: string = typeof j?.choices?.[0]?.message?.content === 'string' ? j.choices[0].message.content.trim() : '';
  if (!text) throw new Error(`${cfg.provider} returned an empty completion`);

  input.onDelta?.(text);

  return {
    text,
    model: cfg.model,
    provider: cfg.provider,
    inputTokens: Number(j?.usage?.prompt_tokens ?? 0),
    outputTokens: Number(j?.usage?.completion_tokens ?? 0),
    latencyMs: Date.now() - started,
  };
}

const ANTHROPIC_FALLBACK_MODEL = 'claude-haiku-4-5';

function buildAgent(name: string, provider: AgentProvider, model: string, openAICfg?: OpenAICompatibleConfig): FederatedAgent {
  return {
    name,
    provider,
    model,
    async think(input: ThinkInput): Promise<ThinkResult> {
      if (provider === 'anthropic' || !openAICfg) return anthropicThink(model, input);
      try {
        return await openAICompatibleThink(openAICfg, input);
      } catch (err) {
        console.warn(
          `[registry] ${name} (${provider}) unavailable — falling back to anthropic/${ANTHROPIC_FALLBACK_MODEL}: ${String(err).slice(0, 120)}`,
        );
        return anthropicThink(ANTHROPIC_FALLBACK_MODEL, input);
      }
    },
  };
}

function openRouterConfig(model: string): OpenAICompatibleConfig {
  return { provider: 'openrouter', baseUrl: OPENROUTER_BASE_URL, keyEnv: 'OPENROUTER_API_KEY', model, headers: OPENROUTER_HEADERS };
}

export const AgentRegistry = {
  // CEO — the boss. Triages intent and delegates to the helpers.
  CLAUDE: buildAgent('Claude', 'openrouter', 'anthropic/claude-3.5-sonnet', openRouterConfig('anthropic/claude-3.5-sonnet')),
  // Helper — code + quantitative analysis.
  CODEX: buildAgent('Codex', 'openrouter', 'openai/gpt-4o-mini', openRouterConfig('openai/gpt-4o-mini')),
  // Helper — research + reconnaissance (the literal "Hermes" model).
  HERMES: buildAgent('Hermes', 'openrouter', 'nousresearch/hermes-3-llama-3.1-70b', openRouterConfig('nousresearch/hermes-3-llama-3.1-70b')),
} as const;

/**
 * Route an agent type to its federated brain. A `modelOverride` (the lane
 * router's SEAT/UP/DOWN escalations pass Anthropic model IDs) binds an
 * anthropic brain to that exact model. Matrix lanes map across all three
 * distinct brains: generic→CLAUDE, coder→CODEX, researcher→HERMES.
 */
export function resolveAgent(agentType: AgentType, modelOverride?: string): FederatedAgent {
  if (modelOverride) return buildAgent(`ModelRouted(${modelOverride})`, 'anthropic', modelOverride);
  switch (agentType) {
    case 'coder':
      return AgentRegistry.CODEX;
    case 'researcher':
    case 'browser':
      return AgentRegistry.HERMES;
    case 'planner':
    default:
      return AgentRegistry.CLAUDE;
  }
}

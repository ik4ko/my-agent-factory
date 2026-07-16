import Anthropic from '@anthropic-ai/sdk';
import type { AgentProvider, FederatedAgent, ThinkInput, ThinkResult } from './types';
import type { AgentType } from '@/lib/types/database.types';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { getSpendSnapshotSince, recordModelEvent } from '@/lib/telemetry/token-ledger';
import { estimateModelCostUsd } from '@/lib/telemetry/pricing';

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
const REGISTRY_MONTHLY_BUDGET_DEFAULT_USD = 3.0;

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

function positiveUsdEnv(name: string): number | null {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function currentUtcMonthStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function registryBudgetUsd(): number {
  return (
    positiveUsdEnv('AGENT_REGISTRY_MONTHLY_BUDGET_USD') ??
    positiveUsdEnv('ANTHROPIC_MONTHLY_BUDGET_USD') ??
    REGISTRY_MONTHLY_BUDGET_DEFAULT_USD
  );
}

function ledgerMode(input: ThinkInput): 'auto' | 'external' | 'off' {
  return input.ledger?.mode ?? 'auto';
}

function telemetryDetail(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(' · ');
}

async function recordRegistryHalt(name: string, model: string, input: ThinkInput, reason: string): Promise<void> {
  await Promise.all([
    hermesLog('error', `[BRAIN] ${name} blocked/failed — ${reason.slice(0, 180)}`),
    recordModelEvent({
      model,
      event: 'HALT',
      taskId: input.ledger?.taskId ?? null,
      agentId: input.ledger?.agentId ?? null,
      detail: telemetryDetail([`registry:${name}`, input.ledger?.detail, reason]),
    }),
  ]);
}

async function guardRegistryBudget(name: string, model: string, input: ThinkInput): Promise<void> {
  const budgetUsd = registryBudgetUsd();
  let spentUsd = 0;
  try {
    const snapshot = await getSpendSnapshotSince(currentUtcMonthStartIso());
    spentUsd = snapshot.totalCostUsd ?? 0;
  } catch (err) {
    const reason = `AgentRegistry budget check failed closed: ${err instanceof Error ? err.message : 'ledger unavailable'}`;
    await recordRegistryHalt(name, model, input, reason);
    throw new Error(reason);
  }

  if (spentUsd >= budgetUsd) {
    const reason = `AgentRegistry monthly budget exceeded: $${spentUsd.toFixed(2)} >= $${budgetUsd.toFixed(2)} cap (AGENT_REGISTRY_MONTHLY_BUDGET_USD)`;
    await recordRegistryHalt(name, model, input, reason);
    throw new Error(reason);
  }
}

async function withRegistryLedger(
  name: string,
  configuredModel: string,
  input: ThinkInput,
  run: () => Promise<ThinkResult>,
): Promise<ThinkResult> {
  if (ledgerMode(input) !== 'auto') return run();

  await guardRegistryBudget(name, configuredModel, input);
  try {
    const result = await run();
    const costUsd = estimateModelCostUsd(result.model, result.inputTokens, result.outputTokens);
    await recordModelEvent({
      model: result.model,
      event: 'USAGE',
      taskId: input.ledger?.taskId ?? null,
      agentId: input.ledger?.agentId ?? null,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      detail: telemetryDetail([
        `registry:${name}`,
        input.ledger?.detail,
        `provider=${result.provider}`,
        `latency=${result.latencyMs}ms`,
        `est_usd=${costUsd.toFixed(6)}`,
      ]),
    });
    return result;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await recordRegistryHalt(name, configuredModel, input, reason.replace(/\s+/g, ' ').slice(0, 220));
    throw err;
  }
}

function buildAgent(name: string, provider: AgentProvider, model: string, openAICfg?: OpenAICompatibleConfig): FederatedAgent {
  return {
    name,
    provider,
    model,
    async think(input: ThinkInput): Promise<ThinkResult> {
      return withRegistryLedger(name, model, input, async () => {
      if (provider === 'anthropic' || !openAICfg) return anthropicThink(model, input);
      try {
        return await openAICompatibleThink(openAICfg, input);
      } catch (err) {
        const reason = String(err).replace(/\s+/g, ' ').slice(0, 160);
        if (process.env.AGENT_REGISTRY_ALLOW_ANTHROPIC_FALLBACK !== 'true') {
          const blocked = `${name} ${provider} call failed and Anthropic fallback is disabled: ${reason}`;
          void hermesLog('error', `[BRAIN] ${blocked}`);
          throw new Error(blocked);
        }
        console.warn(`[registry] ${name} (${provider}) → Haiku fallback: ${reason}`);
        // Surface the real reason in the dashboard terminal so silent fallbacks
        // (missing key / 401 / 402 no-credits / bad model slug) are visible.
        void hermesLog('warn', `[BRAIN] ${name} fell back to Haiku — ${provider} error: ${reason}`);
        return anthropicThink(ANTHROPIC_FALLBACK_MODEL, input);
      }
      });
    },
  };
}

function openRouterConfig(model: string): OpenAICompatibleConfig {
  return { provider: 'openrouter', baseUrl: OPENROUTER_BASE_URL, keyEnv: 'OPENROUTER_API_KEY', model, headers: OPENROUTER_HEADERS };
}

export const AgentRegistry = {
  // CEO — the boss. Runs DIRECT on the latest Anthropic model (no OpenRouter
  // slug to 404 on); always current, always available on the ANTHROPIC_API_KEY.
  CLAUDE: buildAgent('Claude', 'anthropic', 'claude-sonnet-5'),
  // Helper — code + quantitative analysis (GPT via OpenRouter).
  CODEX: buildAgent('Codex', 'openrouter', 'openai/gpt-4o-mini', openRouterConfig('openai/gpt-4o-mini')),
  // Helper — research + reconnaissance (the literal "Hermes" model via OpenRouter).
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
    // Active brains only — researcher/browser work routes to CLAUDE, never
    // HERMES (a future/inactive brain that must not spend from autonomous
    // task execution). HERMES stays exported/visible but code-unreachable.
    case 'researcher':
    case 'browser':
      return AgentRegistry.CLAUDE;
    case 'planner':
    default:
      return AgentRegistry.CLAUDE;
  }
}

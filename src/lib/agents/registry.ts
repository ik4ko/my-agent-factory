import Anthropic from '@anthropic-ai/sdk';
import { resolveChatBackend } from './backend-config';
import { toOpenAITools } from '@/lib/tools/live-tools';
import { runToolCallRounds } from './tool-loop';
import { runAnthropicToolStream } from './anthropic-tool-stream';
import type { AgentProvider, FederatedAgent, ThinkInput, ThinkResult } from './types';
import type { AgentType } from '@/lib/types/database.types';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { getSpendSnapshotSince, recordModelEvent } from '@/lib/telemetry/token-ledger';
import { estimateModelCostUsd } from '@/lib/telemetry/pricing';
import { consumeOpenAICompatibleStream } from './openai-compatible-stream';

/**
 * AgentRegistry — the Federated Brain Network.
 *
 * Two ACTIVE brains:
 *
 *   CLAUDE  (CEO)     → claude-sonnet-5 DIRECT via the Anthropic SDK — the
 *                       boss; triages intent and delegates to the helper.
 *   CODEX   (helper)  → openai/gpt-4o-mini via OpenRouter — code / quant.
 *
 * Degradation contract: if an OpenRouter call fails (or the key is absent),
 * the brain falls back to the direct Anthropic adapter ONLY when
 * AGENT_REGISTRY_ALLOW_ANTHROPIC_FALLBACK=true; otherwise it fails loud. The
 * ThinkResult's provider/model always say what actually ran.
 *
 * Lane-router overrides (Anthropic model IDs like 'claude-haiku-4-5') bind
 * directly to the Anthropic adapter — those IDs are not OpenRouter slugs.
 */

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

  const outcome = await runAnthropicToolStream({
    client: getAnthropic(),
    model,
    system: input.system,
    messages: [{ role: 'user', content: input.prompt }],
    maxTokens: input.maxTokens ?? 2048,
    liveTools: input.liveTools,
    onDelta: input.onDelta,
  });
  inputTokens = outcome.inputTokens;
  outputTokens = outcome.outputTokens;
  text = outcome.text;

  return { text: text.trim(), model, provider: 'anthropic', inputTokens, outputTokens, latencyMs: Date.now() - started };
}

async function openAICompatibleThink(configuredModel: string, input: ThinkInput): Promise<ThinkResult> {
  const started = Date.now();
  const backend = resolveChatBackend();
  if (backend.provider === 'openrouter' && !backend.apiKey) {
    throw new Error('OPENROUTER_API_KEY not configured');
  }
  const model = backend.resolveModel(configuredModel);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const callModel = async (messages: any[]) => {
    const res = await fetch(`${backend.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${backend.apiKey}`, ...backend.headers },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        model,
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: input.maxTokens ?? 2048,
        ...(input.liveTools ? { tools: toOpenAITools() } : {}),
        messages,
      }),
    });
    if (!res.ok) throw new Error(`${backend.provider} responded ${res.status}: ${(await res.text()).slice(0, 120)}`);
    if (!res.body) throw new Error(`${backend.provider} returned no response stream`);
    return consumeOpenAICompatibleStream(res.body, input.onDelta);
  };

  const outcome = await runToolCallRounds({
    messages: [
      { role: 'system', content: input.system },
      { role: 'user', content: input.prompt },
    ],
    callModel,
  });
  const text = outcome.text.trim();
  if (!text) throw new Error(`${backend.provider} returned an empty completion`);

  return {
    text,
    model,
    provider: backend.provider,
    inputTokens: outcome.inputTokens,
    outputTokens: outcome.outputTokens,
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
    // Off the critical path: the caller gets the completion without waiting on
    // the ledger write. Registry runs in plain node workers too, so this is a
    // void-with-catch rather than next/server's after(); metrics are
    // append-only — a lost write under-counts one row, never corrupts state.
    void recordModelEvent({
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
    }).catch((err) => console.warn(`[registry] ${name} usage write failed`, err));
    return result;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await recordRegistryHalt(name, configuredModel, input, reason.replace(/\s+/g, ' ').slice(0, 220));
    throw err;
  }
}

function buildAgent(name: string, provider: AgentProvider, model: string): FederatedAgent {
  return {
    name,
    provider,
    model,
    async think(input: ThinkInput): Promise<ThinkResult> {
      return withRegistryLedger(name, model, input, async () => {
      if (provider === 'anthropic') return anthropicThink(model, input);
      try {
        return await openAICompatibleThink(model, input);
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

export const AgentRegistry = {
  // CEO — the boss. Runs DIRECT on the latest Anthropic model (no OpenRouter
  // slug to 404 on); always current, always available on the ANTHROPIC_API_KEY.
  CLAUDE: buildAgent('Claude', 'anthropic', 'claude-sonnet-5'),
  // Helper — code + quantitative analysis. OpenRouter by default; routed to a
  // local OpenAI-compatible server when AI_LOCAL_BASE_URL is set (see
  // backend-config.ts).
  CODEX: buildAgent('Codex', 'openrouter', 'openai/gpt-4o-mini'),
} as const;

/**
 * Route an agent type to its federated brain. A `modelOverride` (the lane
 * router's SEAT/UP/DOWN escalations pass Anthropic model IDs) binds an
 * anthropic brain to that exact model. Otherwise: coder→CODEX, everything
 * else→CLAUDE.
 */
export function resolveAgent(agentType: AgentType, modelOverride?: string): FederatedAgent {
  if (modelOverride) return buildAgent(`ModelRouted(${modelOverride})`, 'anthropic', modelOverride);
  switch (agentType) {
    case 'coder':
      return AgentRegistry.CODEX;
    // Active brains only — researcher/browser work routes to CLAUDE so no
    // inactive lane can spend from autonomous task execution.
    case 'researcher':
    case 'browser':
      return AgentRegistry.CLAUDE;
    case 'planner':
    default:
      return AgentRegistry.CLAUDE;
  }
}

'use server';

// Multi-tier OpenRouter brain dispatcher. Server Action only: the API key
// never leaves this module, and every invocation is gated on the same
// operator session cookie the middleware enforces (server actions are
// publicly invocable POST endpoints — session validation here is mandatory,
// not optional).
import { cookies } from 'next/headers';
import { after } from 'next/server';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth/session';
import { resolveChatBackend } from '@/lib/agents/backend-config';
import { ACTIVE_BRAIN_IDS, BRAIN_MATRIX, type BrainId, type BrainDef } from '@/lib/agents/brain-matrix';
import { classifyNvidiaFailure } from '@/lib/agents/nvidia-errors';
import { agentLog } from '@/lib/hermes/hermes-logger';
import { getAdminClient } from '@/lib/supabase/admin';
import { getSpendSnapshotSince, recordModelEvent } from '@/lib/telemetry/token-ledger';
import { estimateModelCostUsd } from '@/lib/telemetry/pricing';
import { extractTradeParams, buildStagedOrder, persistStagedOrder } from '@/lib/trading/stage';
import { getActivePortfolioBalance } from '@/lib/market/portfolio';
import { publishAgentEvent } from '@/lib/omnigent/bridge';
import { formatRelevantFacts, selectRelevantFacts, type PendingLifeContextProposal } from '@/lib/life-context/types';
import { readLifeContext, proposeLifeContextCandidates } from '@/lib/life-context/store';
import { LIFE_CONTEXT_MODEL_INSTRUCTIONS, parseLifeContextProposals } from '@/lib/life-context/model-proposals';
import { LifeContextProposalHoldback } from '@/lib/life-context/proposal-stream';
import { recordFeedbackEvent } from '@/lib/telemetry/feedback-ledger';
import { toOpenAIResponsesTools, toOpenAITools } from '@/lib/tools/live-tools';
import { runResponsesToolRounds, runToolCallRounds } from '@/lib/agents/tool-loop';
import { runAnthropicToolStream } from '@/lib/agents/anthropic-tool-stream';
import { consumeOpenAICompatibleStream } from '@/lib/agents/openai-compatible-stream';

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_HISTORY = 24;
const CODE_FENCE = /```/;

// Anthropic-direct lane pricing — the CONSERVATIVE standard rate (the $2/$10
// intro rate is deliberately ignored so the budget cap trips early, never
// late). Sonnet 5 standard: $3 / $15 per million input / output tokens.
const ANTHROPIC_INPUT_USD_PER_MTOK = 3;
const ANTHROPIC_OUTPUT_USD_PER_MTOK = 15;
const ANTHROPIC_MONTHLY_BUDGET_DEFAULT_USD = 3.0;
const ANTHROPIC_MAX_TOKENS = 4096;
const OPENROUTER_MONTHLY_BUDGET_DEFAULT_USD = 1.0;

// OpenAI-direct lane pricing — gpt-5.3-codex standard rate, priced
// CONSERVATIVELY at $1.75 / $14.00 per million input / output tokens so the
// budget cap trips early, never late. Used by both the budget gate and the
// ledger's running spend.
const OPENAI_INPUT_USD_PER_MTOK = 1.75;
const OPENAI_OUTPUT_USD_PER_MTOK = 14;
const OPENAI_MONTHLY_BUDGET_DEFAULT_USD = 3.0;
// gpt-5.3-codex is a reasoning model on the Responses API: max_output_tokens
// caps reasoning + visible answer together — set high enough that low-effort
// reasoning cannot starve the visible answer.
const OPENAI_MAX_COMPLETION_TOKENS = 8192;
// Floor the reasoning effort — the OpenAI analog of Anthropic's
// thinking:disabled. Keeps latency and (output-priced) reasoning tokens
// predictable against the budget cap.
const OPENAI_REASONING_EFFORT = 'low' as const;

// NVIDIA-direct lane (experimental, free-tier). Endpoint + auth verified
// against NVIDIA's hosted-API docs 2026-07-13: OpenAI-compatible chat
// completions at integrate.api.nvidia.com, Authorization: Bearer nvapi-….
// Free tier = finite signup credits + 40 requests/minute, so exhaustion and
// rate-limiting are expected failure modes with their own reporting.
const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const NVIDIA_MAX_TOKENS = 2048;

export type AgentId = BrainId;

const DispatchSchema = z.object({
  agentId: z.enum(ACTIVE_BRAIN_IDS),
  prompt: z.string().min(1).max(16_000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(16_000),
      })
    )
    .max(64)
    .default([]),
});

export type AgentDispatchInput = z.input<typeof DispatchSchema>;

export interface MaterializedArtifact {
  type: 'task' | 'staged_order';
  id: string;
  label: string;
}

export interface AgentDispatchResult {
  agentId: AgentId;
  modelUsed: string;
  content: string;
  timestamp: string;
  /** Present only on failure; content is '' in that case. */
  error?: string;
  /** Live-table rows this reply produced (Tasks panel / Staged Orders). */
  materialized?: MaterializedArtifact[];
  /** Sensitive/inferred/corrective memories awaiting an explicit action-by-ID. */
  lifeContextProposals?: PendingLifeContextProposal[];
  /** Per-segment production timings for tool-loop profiling. */
  toolLoopTimings?: { modelRoundMs: number[]; toolCalls: Array<{ name: string; latencyMs: number }> };
}

const MENTOR_AGENT_IDS = new Set<AgentId>(['MENTOR_BUSINESS', 'MENTOR_MONEY', 'MENTOR_LIFE', 'MENTOR_HEALTH']);

/**
 * Success-path telemetry must not sit between the model's answer and the
 * operator seeing it. after() keeps the write alive past the response on
 * serverless runtimes; a failed write logs a warning and is NOT retried —
 * metrics are append-only, so the worst case is one usage row missing (the
 * budget gates under-count by at most that row), never corrupted state or a
 * double-logged event. Error/HALT paths stay awaited: they are terminal.
 */
function deferTelemetry(task: () => Promise<unknown>): void {
  after(() => task().catch((err) => console.warn('[dispatch] telemetry write failed', err)));
}

async function prepareMentorPrompt(agentId: AgentId, prompt: string): Promise<{ prompt: string; factsSelected: number }> {
  if (!MENTOR_AGENT_IDS.has(agentId)) return { prompt, factsSelected: 0 };
  const document = await readLifeContext();
  const relevant = selectRelevantFacts(document.facts, prompt);
  const summary = formatRelevantFacts(relevant);
  return {
    prompt: [summary, LIFE_CONTEXT_MODEL_INSTRUCTIONS, `Current user message:\n${prompt}`].filter(Boolean).join('\n\n'),
    factsSelected: relevant.length,
  };
}

interface MentorDispatchMeta {
  startedAt?: number;
  factsSelected?: number;
}

/** Feedback-ledger tap: every mentor dispatch (all providers, sync and
 *  streamed) funnels through finalizeMentorResult, so signal capture lives
 *  here. Best-effort — never blocks or fails the reply. */
function recordMentorReplySignal(agentId: AgentId, result: AgentDispatchResult, meta?: MentorDispatchMeta): void {
  if (!MENTOR_AGENT_IDS.has(agentId)) return;
  const backend = resolveChatBackend();
  void recordFeedbackEvent({
    kind: result.error ? 'mentor_reply_error' : 'mentor_reply',
    mentorId: agentId,
    model: result.modelUsed,
    provider: backend.provider,
    backend: backend.provider === 'local' ? 'local' : 'hosted',
    latencyMs: meta?.startedAt ? Date.now() - meta.startedAt : null,
    factsSelected: meta?.factsSelected ?? null,
    note: result.error ? result.error.slice(0, 300) : null,
  });
}

async function finalizeMentorResult(agentId: AgentId, originalPrompt: string, result: AgentDispatchResult, meta?: MentorDispatchMeta): Promise<AgentDispatchResult> {
  recordMentorReplySignal(agentId, result, meta);
  if (!MENTOR_AGENT_IDS.has(agentId) || result.error) return result;
  const parsed = parseLifeContextProposals(result.content);
  if (parsed.candidates.length === 0) return { ...result, content: parsed.content };
  try {
    const proposed = await proposeLifeContextCandidates({
      candidates: parsed.candidates,
      userMessage: originalPrompt,
      mentorId: agentId,
      sourceMessageId: crypto.randomUUID(),
    });
    return { ...result, content: parsed.content, ...(proposed.pending.length ? { lifeContextProposals: proposed.pending } : {}) };
  } catch (error) {
    await agentLog('warn', agentId, `life-context proposal write skipped — ${error instanceof Error ? error.message : 'unknown error'}`);
    return { ...result, content: parsed.content };
  }
}

interface OpenRouterResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

interface PreparedDispatch {
  agentId: AgentId;
  agent: BrainDef;
  prompt: string;
  dispatchPrompt: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Feedback-ledger context: dispatch start + life-context facts injected. */
  startedAt: number;
  factsSelected: number;
}

function dispatchFailure(agentId: AgentId, modelUsed: string, error: string): AgentDispatchResult {
  return { agentId, modelUsed, content: '', timestamp: new Date().toISOString(), error };
}

async function assertOperatorSession(): Promise<void> {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) throw new Error('DASHBOARD_PASSWORD not configured');
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await verifySessionToken(token, password))) {
    throw new Error('Unauthorized: valid operator session required');
  }
}

async function prepareDispatch(rawInput: AgentDispatchInput): Promise<{ prepared?: PreparedDispatch; failure?: AgentDispatchResult }> {
  const parsed = DispatchSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { failure: dispatchFailure('CLAUDE', 'none', `invalid dispatch payload: ${parsed.error.issues[0]?.message ?? 'validation failed'}`) };
  }
  const { agentId, prompt, history } = parsed.data;
  const agent: BrainDef = BRAIN_MATRIX[agentId];
  try {
    await assertOperatorSession();
    const mentorPrompt = await prepareMentorPrompt(agentId, prompt);
    return {
      prepared: {
        agentId,
        agent,
        prompt,
        dispatchPrompt: mentorPrompt.prompt,
        history,
        startedAt: Date.now(),
        factsSelected: mentorPrompt.factsSelected,
      },
    };
  } catch (error) {
    return { failure: dispatchFailure(agentId, agent.model, error instanceof Error ? error.message : 'dispatch preparation failed') };
  }
}

/**
 * Console → live-table bridge. A matrix reply is inert text until something
 * routes it into the tables the rest of the dashboard already watches over
 * realtime — Tasks (CODEX patches) and Staged Orders (GROK theses). Both
 * writes go through the same audited primitives the multi-agent pipeline
 * uses (stage.ts's Kelly sizing + hard caps for orders), so a chat-originated
 * proposal is held to the identical never-executed, human-approval bar.
 * Never throws — a materialization failure must not fail the chat reply.
 */
async function materializeArtifacts(
  agentId: AgentId,
  prompt: string,
  content: string,
  model: string
): Promise<MaterializedArtifact[]> {
  const artifacts: MaterializedArtifact[] = [];

  if (agentId === 'CODEX' && CODE_FENCE.test(content)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = getAdminClient() as any;
      const { data, error } = await db
        .from('tasks')
        .insert({
          description: prompt.slice(0, 500),
          status: 'completed',
          agent_id: null,
          model,
          result: { source: 'chat', agentId, model, preview: content.slice(0, 400), chars: content.length },
        })
        .select('id')
        .single();
      if (!error && data?.id) {
        artifacts.push({ type: 'task', id: data.id, label: `task ${String(data.id).slice(0, 8)}` });
        await agentLog('success', agentId, `patch materialized → task ${String(data.id).slice(0, 8)}`);
      }
    } catch {
      /* materialization is best-effort */
    }
  }

  if (agentId === 'GROK') {
    try {
      const params = extractTradeParams(content);
      if (params) {
        const equityUsd = await getActivePortfolioBalance();
        const { staged, reason } = buildStagedOrder(params, {
          pipelineId: null,
          source: 'SANDBOX',
          equityUsd,
        });
        if (staged) {
          await persistStagedOrder(staged);
          artifacts.push({
            type: 'staged_order',
            id: staged.id,
            label: `${staged.underlying} ${staged.option_type} ${staged.strike} staged`,
          });
          const expectancy = staged.expectancy ?? 0;
          await agentLog('success', agentId, `thesis staged → ${staged.underlying} ${staged.option_type} ${staged.strike} (E=${expectancy.toFixed(2)}R, awaiting approval)`);
        } else if (reason) {
          await agentLog('warn', agentId, `thesis parsed but not staged — ${reason}`);
        }
      }
    } catch {
      /* materialization is best-effort */
    }
  }

  return artifacts;
}

/**
 * Calendar-month Anthropic spend in USD, priced at the conservative standard
 * $3/$15 rate from the metrics ledger (every anthropic-direct dispatch writes
 * a `USAGE` row keyed by the returned model id, which begins "claude"). Throws
 * on a query failure so the caller can FAIL CLOSED rather than dispatch blind.
 */
async function anthropicMonthlySpendUsd(): Promise<number> {
  const db = getAdminClient();
  const now = new Date();
  const monthStartIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { data, error } = await db
    .from('metrics')
    .select('input_tokens, output_tokens')
    .like('model', 'claude%')
    .gte('created_at', monthStartIso)
    .limit(50_000);
  if (error) throw new Error(error.message);
  let usd = 0;
  for (const row of data ?? []) {
    usd +=
      ((row.input_tokens ?? 0) / 1_000_000) * ANTHROPIC_INPUT_USD_PER_MTOK +
      ((row.output_tokens ?? 0) / 1_000_000) * ANTHROPIC_OUTPUT_USD_PER_MTOK;
  }
  return usd;
}

/**
 * Anthropic-direct dispatch (the CLAUDE lane). Parallel to the OpenRouter path
 * but through the official SDK: no temperature (Sonnet 5 rejects it), a
 * hard monthly budget gate that fails LOUD with no downgrade, and exact usage
 * recorded to the same metrics ledger the budget reads. Honors the file's
 * sovereign contract — verbatim model, fail-loud, no provider fallback.
 */
async function dispatchAnthropic(
  agentId: AgentId,
  agent: BrainDef,
  prompt: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<AgentDispatchResult> {
  const fail = (error: string): AgentDispatchResult => ({
    agentId,
    modelUsed: agent.model,
    content: '',
    timestamp: new Date().toISOString(),
    error,
  });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fail('ANTHROPIC_API_KEY not configured');

  // Budget gate — fail CLOSED on a query error, and never silently downgrade.
  const budgetUsd = Number(process.env.ANTHROPIC_MONTHLY_BUDGET_USD) || ANTHROPIC_MONTHLY_BUDGET_DEFAULT_USD;
  let spentUsd: number;
  try {
    spentUsd = await anthropicMonthlySpendUsd();
  } catch (err) {
    const reason = `budget check failed (fail-closed) — ${err instanceof Error ? err.message : 'metrics query error'}`;
    await agentLog('error', agentId, reason);
    return fail(reason);
  }
  if (spentUsd >= budgetUsd) {
    const reason = `Anthropic monthly budget exceeded: $${spentUsd.toFixed(2)} ≥ $${budgetUsd.toFixed(2)} cap (ANTHROPIC_MONTHLY_BUDGET_USD) — no fallback`;
    await agentLog('warn', agentId, `dispatch blocked — ${reason}`);
    return fail(reason);
  }

  const client = new Anthropic({ apiKey });
  const t0 = Date.now();
  try {
    const msg = await client.messages.create({
      model: agent.model,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      // No temperature — Sonnet 5 rejects non-default sampling params.
      // Thinking disabled for parity with the completion-style matrix lanes
      // and predictable token accounting against the budget cap.
      thinking: { type: 'disabled' },
      system: agent.system,
      messages: [
        ...history.slice(-MAX_HISTORY),
        { role: 'user' as const, content: prompt },
      ],
    });
    const latencyMs = Date.now() - t0;

    const content = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    if (!content) {
      await agentLog('error', agentId, `dispatch failed after ${latencyMs}ms — empty completion`);
      return fail('Anthropic returned an empty completion');
    }

    // Usage → ledger (the budget query above reads these rows next month/call).
    // Keyed by the API-returned model id, which is the genuine Anthropic proof.
    // NOTE: metrics.agent_id is a uuid column — the brain-lane name cannot go
    // there, so it rides in `detail`. The budget gate keys off model, not agent.
    deferTelemetry(() => Promise.all([
      recordModelEvent({
        model: msg.model,
        event: 'USAGE',
        inputTokens: msg.usage.input_tokens,
        outputTokens: msg.usage.output_tokens,
        detail: `${agentId} lane · ${latencyMs}ms`,
      }),
      agentLog(
        'success',
        agentId,
        `dispatch completed in ${latencyMs}ms · ${msg.model} · in=${msg.usage.input_tokens} out=${msg.usage.output_tokens}`,
      ),
    ]));
    const materialized = await materializeArtifacts(agentId, prompt, content, msg.model);

    // Private lanes (mentors) never mirror prompt/reply snippets off-box.
    if (!agent.private) {
      publishAgentEvent({
        kind: 'agent.task_completed',
        agentId,
        taskId: null,
        summary: `${prompt.slice(0, 120)} → ${content.slice(0, 160)}`,
        ts: Date.now(),
      });
    }

    return {
      agentId,
      modelUsed: msg.model,
      content,
      timestamp: new Date().toISOString(),
      ...(materialized.length > 0 ? { materialized } : {}),
    };
  } catch (err) {
    const latencyMs = Date.now() - t0;
    const reason = err instanceof Error ? err.message : 'dispatch failed';
    await agentLog('error', agentId, `dispatch failed after ${latencyMs}ms — ${reason}`);
    return fail(reason);
  }
}

/**
 * Calendar-month OpenAI spend in USD, priced at the conservative gpt-5.3-codex
 * $1.75/$14.00 rate from the metrics ledger (every openai-direct dispatch
 * writes a `USAGE` row keyed by the returned model id, which begins "gpt").
 * Throws on a query failure so the caller can FAIL CLOSED rather than dispatch
 * blind.
 */
// 60s memo — this gate was re-scanning up to 50k metric rows per dispatch.
// Staleness can under-count at most one minute of spend against a
// conservatively-priced cap; query failures are never cached (fail closed).
let openaiSpendCache: { at: number; usd: number } | null = null;

async function openaiMonthlySpendUsd(): Promise<number> {
  if (openaiSpendCache && Date.now() - openaiSpendCache.at < 60_000) return openaiSpendCache.usd;
  const db = getAdminClient();
  const now = new Date();
  const monthStartIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { data, error } = await db
    .from('metrics')
    .select('input_tokens, output_tokens')
    .like('model', 'gpt%')
    .gte('created_at', monthStartIso)
    .limit(50_000);
  if (error) throw new Error(error.message);
  let usd = 0;
  for (const row of data ?? []) {
    usd +=
      ((row.input_tokens ?? 0) / 1_000_000) * OPENAI_INPUT_USD_PER_MTOK +
      ((row.output_tokens ?? 0) / 1_000_000) * OPENAI_OUTPUT_USD_PER_MTOK;
  }
  openaiSpendCache = { at: Date.now(), usd };
  return usd;
}

/**
 * OpenAI-direct dispatch (the CODEX lane). Parallel to dispatchAnthropic but
 * through the official OpenAI SDK — on the RESPONSES API: codex-line models
 * are not served on /v1/chat/completions at all (404, verified live), and as
 * reasoning models they take no temperature; reasoning effort is floored to
 * keep cost predictable. A hard monthly budget gate that fails LOUD with no
 * downgrade, and exact usage recorded to the same metrics ledger the gate
 * reads. Honors the sovereign contract — verbatim model, fail-loud, no
 * provider fallback.
 */
async function dispatchOpenAI(
  agentId: AgentId,
  agent: BrainDef,
  prompt: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<AgentDispatchResult> {
  const fail = (error: string): AgentDispatchResult => ({
    agentId,
    modelUsed: agent.model,
    content: '',
    timestamp: new Date().toISOString(),
    error,
  });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fail('OPENAI_API_KEY not configured');

  // Budget gate — fail CLOSED on a query error, and never silently downgrade.
  const budgetUsd = Number(process.env.OPENAI_MONTHLY_BUDGET_USD) || OPENAI_MONTHLY_BUDGET_DEFAULT_USD;
  let spentUsd: number;
  try {
    spentUsd = await openaiMonthlySpendUsd();
  } catch (err) {
    const reason = `budget check failed (fail-closed) — ${err instanceof Error ? err.message : 'metrics query error'}`;
    await agentLog('error', agentId, reason);
    return fail(reason);
  }
  if (spentUsd >= budgetUsd) {
    const reason = `OpenAI monthly budget exceeded: $${spentUsd.toFixed(2)} ≥ $${budgetUsd.toFixed(2)} cap (OPENAI_MONTHLY_BUDGET_USD) — no fallback`;
    await agentLog('warn', agentId, `dispatch blocked — ${reason}`);
    return fail(reason);
  }

  const client = new OpenAI({ apiKey });
  const t0 = Date.now();
  try {
    // RESPONSES API, not chat completions — verified live 2026-07-13: the
    // codex-line models 404 on /v1/chat/completions ("Use the v1/responses
    // endpoint instead"). No temperature (gpt-5.x reasoning models reject
    // non-default sampling); reasoning effort floored (parity with the
    // Anthropic branch's thinking:disabled); max_output_tokens caps
    // reasoning + answer together, so it stays generous.
    const outcome = await runResponsesToolRounds({
      input: [
        ...history.slice(-MAX_HISTORY),
        { role: 'user' as const, content: prompt },
      ],
      callModel: async (input) => {
        const response = await client.responses.create({
          model: agent.model,
          instructions: agent.system,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          input: input as any,
          max_output_tokens: OPENAI_MAX_COMPLETION_TOKENS,
          reasoning: { effort: OPENAI_REASONING_EFFORT },
          tools: toOpenAIResponsesTools(),
        });
        return {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          outputItems: (response.output ?? []) as any[],
          text: response.output_text ?? '',
          model: response.model,
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
          status: response.status,
          incompleteReason: response.incomplete_details?.reason ?? undefined,
        };
      },
    });
    const latencyMs = Date.now() - t0;
    const response = { model: outcome.model ?? agent.model, usage: { input_tokens: outcome.inputTokens, output_tokens: outcome.outputTokens } };

    const content = outcome.text;
    if (!content) {
      const why =
        outcome.status === 'incomplete' && outcome.incompleteReason === 'max_output_tokens'
          ? 'token cap reached before any answer (reasoning consumed the budget)'
          : `empty completion (status ${outcome.status ?? 'unknown'})`;
      await agentLog('error', agentId, `dispatch failed after ${latencyMs}ms — ${why}`);
      return fail(`OpenAI returned an empty completion (${why})`);
    }

    // Usage → ledger (the budget query above reads these rows next call/month).
    // Keyed by the API-returned model id (begins "gpt"), the genuine OpenAI
    // proof that this was a direct call, not the OpenRouter proxy. metrics
    // .agent_id is a uuid column, so the lane name rides in `detail`.
    deferTelemetry(() => Promise.all([
      recordModelEvent({
        model: response.model,
        event: 'USAGE',
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
        detail: `${agentId} lane · ${latencyMs}ms`,
      }),
      agentLog(
        'success',
        agentId,
        `dispatch completed in ${latencyMs}ms · ${response.model} · in=${response.usage?.input_tokens ?? 0} out=${response.usage?.output_tokens ?? 0}`,
      ),
    ]));
    const materialized = await materializeArtifacts(agentId, prompt, content, response.model);

    // Private lanes (mentors) never mirror prompt/reply snippets off-box.
    if (!agent.private) {
      publishAgentEvent({
        kind: 'agent.task_completed',
        agentId,
        taskId: null,
        summary: `${prompt.slice(0, 120)} → ${content.slice(0, 160)}`,
        ts: Date.now(),
      });
    }

    return {
      agentId,
      modelUsed: response.model,
      content,
      timestamp: new Date().toISOString(),
      ...(materialized.length > 0 ? { materialized } : {}),
    };
  } catch (err) {
    const latencyMs = Date.now() - t0;
    const reason = err instanceof Error ? err.message : 'dispatch failed';
    await agentLog('error', agentId, `dispatch failed after ${latencyMs}ms — ${reason}`);
    return fail(reason);
  }
}

/**
 * NVIDIA-direct dispatch (the experimental NEMOTRON lane). OpenAI-compatible
 * wire shape over plain fetch — but NOT assumed identical: verified against
 * NVIDIA's docs (model id, endpoint, bearer-token auth; temperature and
 * max_tokens are supported on this lane, unlike the reasoning-model lanes).
 * Free-tier reality is encoded here: 429 (40 RPM) and credit exhaustion are
 * DISTINCT, plainly-worded failures — an expected outcome of a finite free
 * tier, not a generic dispatch error. Fail-loud, no fallback to any other
 * lane, per the file's sovereign contract.
 */
async function dispatchNvidia(
  agentId: AgentId,
  agent: BrainDef,
  prompt: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<AgentDispatchResult> {
  const fail = (error: string): AgentDispatchResult => ({
    agentId,
    modelUsed: agent.model,
    content: '',
    timestamp: new Date().toISOString(),
    error,
  });

  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) return fail('NVIDIA_API_KEY not configured (nvapi-… key from build.nvidia.com)');

  const t0 = Date.now();
  try {
    const res = await fetch(NVIDIA_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: agent.model,
        temperature: agent.temperature,
        max_tokens: NVIDIA_MAX_TOKENS,
        messages: [
          { role: 'system' as const, content: agent.system },
          ...history.slice(-MAX_HISTORY),
          { role: 'user' as const, content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    });
    const latencyMs = Date.now() - t0;
    const data = (await res.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
      error?: { message?: string; code?: string };
    };

    if (!res.ok) {
      // ── Distinct free-tier failure modes — expected, not exceptional.
      // Classification is pure + unit-tested (src/lib/agents/nvidia-errors.ts):
      // 429 → rate-limit, 402/403+credit-text → exhaustion, else generic.
      const failure = classifyNvidiaFailure(res.status, data.error?.message ?? '');
      await agentLog(
        failure.kind === 'api-error' ? 'error' : 'warn',
        agentId,
        `dispatch ${failure.kind === 'api-error' ? 'failed' : 'blocked'} after ${latencyMs}ms — ${failure.reason}`,
      );
      return fail(failure.reason);
    }

    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      await agentLog('error', agentId, `dispatch failed after ${latencyMs}ms — empty completion`);
      return fail('NVIDIA returned an empty completion');
    }

    // Usage → ledger. NVIDIA model ids ("nvidia/…") don't collide with the
    // claude%/gpt% budget queries; there is no USD budget here — the finite
    // resource is the credit pool, and its exhaustion reports loudly above.
    deferTelemetry(() => Promise.all([
      recordModelEvent({
        model: data.model ?? agent.model,
        event: 'USAGE',
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        detail: `${agentId} lane · ${latencyMs}ms`,
      }),
      agentLog('success', agentId, `dispatch completed in ${latencyMs}ms · ${data.model ?? agent.model} · in=${data.usage?.prompt_tokens ?? 0} out=${data.usage?.completion_tokens ?? 0}`),
    ]));
    const materialized = await materializeArtifacts(agentId, prompt, content, data.model ?? agent.model);

    // Private lanes (mentors) never mirror prompt/reply snippets off-box.
    if (!agent.private) {
      publishAgentEvent({
        kind: 'agent.task_completed',
        agentId,
        taskId: null,
        summary: `${prompt.slice(0, 120)} → ${content.slice(0, 160)}`,
        ts: Date.now(),
      });
    }

    return {
      agentId,
      modelUsed: data.model ?? agent.model,
      content,
      timestamp: new Date().toISOString(),
      ...(materialized.length > 0 ? { materialized } : {}),
    };
  } catch (err) {
    const latencyMs = Date.now() - t0;
    const reason =
      err instanceof Error && err.name === 'TimeoutError'
        ? `request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
        : err instanceof Error
          ? err.message
          : 'dispatch failed';
    await agentLog('error', agentId, `dispatch failed after ${latencyMs}ms — ${reason}`);
    return fail(reason);
  }
}

export async function dispatchAgent(rawInput: AgentDispatchInput): Promise<AgentDispatchResult> {
  const preparation = await prepareDispatch(rawInput);
  if (!preparation.prepared) return preparation.failure!;
  const { agentId, agent, prompt, dispatchPrompt, history } = preparation.prepared;
  const fail = (id: AgentId, model: string, error: string) => dispatchFailure(id, model, error);

  // Provider branch — anthropic-direct lanes never touch OpenRouter. Session
  // gate above still applies (this is reached only after it passes).
  if (agent.provider === 'anthropic-direct') {
    return finalizeMentorResult(agentId, prompt, await dispatchAnthropic(agentId, agent, dispatchPrompt, history), preparation.prepared);
  }
  if (agent.provider === 'openai-direct') {
    return finalizeMentorResult(agentId, prompt, await dispatchOpenAI(agentId, agent, dispatchPrompt, history), preparation.prepared);
  }
  if (agent.provider === 'nvidia-direct') {
    return finalizeMentorResult(agentId, prompt, await dispatchNvidia(agentId, agent, dispatchPrompt, history), preparation.prepared);
  }

  const backend = resolveChatBackend();
  if (backend.provider === 'openrouter' && !backend.apiKey) {
    return fail(agentId, agent.model, 'OPENROUTER_API_KEY not configured');
  }

  // Budget gate applies only to the hosted (paid) backend — local inference
  // costs nothing and must not be blocked by the OpenRouter cap.
  if (backend.provider === 'openrouter') {
    const openRouterBudgetUsd = positiveUsdEnv('OPENROUTER_MONTHLY_BUDGET_USD') ?? OPENROUTER_MONTHLY_BUDGET_DEFAULT_USD;
    let openRouterSpentUsd: number;
    try {
      openRouterSpentUsd = await openRouterMonthlySpendUsd();
    } catch (err) {
      const reason = `OpenRouter budget check failed (fail-closed) — ${err instanceof Error ? err.message : 'metrics query error'}`;
      await agentLog('error', agentId, reason);
      await recordModelEvent({ model: agent.model, event: 'HALT', detail: `${agentId} lane · provider=openrouter · ${reason}` });
      return fail(agentId, agent.model, reason);
    }
    if (openRouterSpentUsd >= openRouterBudgetUsd) {
      const reason = `OpenRouter monthly budget exceeded: $${openRouterSpentUsd.toFixed(2)} ≥ $${openRouterBudgetUsd.toFixed(2)} cap (OPENROUTER_MONTHLY_BUDGET_USD)`;
      await agentLog('warn', agentId, `dispatch blocked — ${reason}`);
      await recordModelEvent({ model: agent.model, event: 'HALT', detail: `${agentId} lane · provider=openrouter · ${reason}` });
      return fail(agentId, agent.model, reason);
    }
  }

  const messages = [
    { role: 'system' as const, content: agent.system },
    ...history.slice(-MAX_HISTORY),
    { role: 'user' as const, content: dispatchPrompt },
  ];

  const dispatchModel = backend.resolveModel(agent.model);
  const t0 = Date.now();
  try {
    const res = await fetch(`${backend.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${backend.apiKey}`,
        'Content-Type': 'application/json',
        ...backend.headers,
      },
      body: JSON.stringify({
        model: dispatchModel,
        temperature: agent.temperature,
        messages,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    });
    const latencyMs = Date.now() - t0;

    const data = (await res.json().catch(() => ({}))) as OpenRouterResponse;
    if (!res.ok) {
      const reason = `${backend.provider === 'local' ? 'Local AI server' : 'OpenRouter'} ${res.status}: ${data.error?.message ?? 'request failed'}`;
      await agentLog('error', agentId, `dispatch failed after ${latencyMs}ms — ${reason}`);
      return fail(agentId, agent.model, reason);
    }

    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      await agentLog('error', agentId, `dispatch failed after ${latencyMs}ms — empty completion`);
      return fail(agentId, agent.model, `${backend.provider === 'local' ? 'Local AI server' : 'OpenRouter'} returned an empty completion`);
    }

    const inputTokens = Number(data.usage?.prompt_tokens ?? 0);
    const outputTokens = Number(data.usage?.completion_tokens ?? 0);
    const costUsd = backend.provider === 'local' ? 0 : estimateModelCostUsd(dispatchModel, inputTokens, outputTokens);
    deferTelemetry(() => Promise.all([
      agentLog('success', agentId, `dispatch completed in ${latencyMs}ms · ${dispatchModel}`),
      recordModelEvent({
        model: dispatchModel,
        event: 'USAGE',
        inputTokens,
        outputTokens,
        detail: `${agentId} lane · provider=${backend.provider} · latency=${latencyMs}ms · est_usd=${costUsd.toFixed(6)}`,
      }),
    ]));

    const materialized = await materializeArtifacts(agentId, prompt, content, dispatchModel);

    // Private lanes (mentors) never mirror prompt/reply snippets off-box.
    if (!agent.private) {
      publishAgentEvent({
        kind: 'agent.task_completed',
        agentId,
        taskId: null,
        summary: `${prompt.slice(0, 120)} → ${content.slice(0, 160)}`,
        ts: Date.now(),
      });
    }

    return finalizeMentorResult(agentId, prompt, {
      agentId,
      modelUsed: dispatchModel,
      content,
      timestamp: new Date().toISOString(),
      ...(materialized.length > 0 ? { materialized } : {}),
    }, preparation.prepared);
  } catch (err) {
    const latencyMs = Date.now() - t0;
    const reason =
      err instanceof Error && err.name === 'TimeoutError'
        ? `request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
        : err instanceof Error
          ? err.message
          : 'dispatch failed';
    await agentLog('error', agentId, `dispatch failed after ${latencyMs}ms — ${reason}`);
    recordMentorReplySignal(agentId, fail(agentId, agent.model, reason), preparation.prepared);
    return fail(agentId, agent.model, reason);
  }
}

async function completeStreamedDispatch(
  prepared: PreparedDispatch,
  content: string,
  model: string,
  usage: {
    inputTokens: number;
    outputTokens: number;
    modelRoundMs?: number[];
    toolCalls?: Array<{ name: string; latencyMs: number }>;
  },
  latencyMs: number,
): Promise<AgentDispatchResult> {
  const { agentId, agent, prompt } = prepared;
  if (!content) return dispatchFailure(agentId, model, 'provider returned an empty completion');
  deferTelemetry(() => Promise.all([
    recordModelEvent({ model, event: 'USAGE', inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, detail: `${agentId} lane · ${latencyMs}ms · streamed` }),
    agentLog('success', agentId, `stream dispatch completed in ${latencyMs}ms · ${model} · in=${usage.inputTokens} out=${usage.outputTokens}`),
  ]));
  const materialized = await materializeArtifacts(agentId, prompt, content, model);
  if (!agent.private) {
    publishAgentEvent({ kind: 'agent.task_completed', agentId, taskId: null, summary: `${prompt.slice(0, 120)} → ${content.slice(0, 160)}`, ts: Date.now() });
  }
  return finalizeMentorResult(agentId, prompt, {
    agentId,
    modelUsed: model,
    content,
    timestamp: new Date().toISOString(),
    ...(usage.modelRoundMs?.length
      ? { toolLoopTimings: { modelRoundMs: usage.modelRoundMs, toolCalls: usage.toolCalls ?? [] } }
      : {}),
    ...(materialized.length ? { materialized } : {}),
  }, prepared);
}

async function guardStreamingBudget(prepared: PreparedDispatch): Promise<string | null> {
  const { agentId, agent } = prepared;
  if (agent.provider === 'anthropic-direct') {
    const cap = Number(process.env.ANTHROPIC_MONTHLY_BUDGET_USD) || ANTHROPIC_MONTHLY_BUDGET_DEFAULT_USD;
    try {
      const spent = await anthropicMonthlySpendUsd();
      return spent >= cap ? `Anthropic monthly budget exceeded: $${spent.toFixed(2)} ≥ $${cap.toFixed(2)} cap` : null;
    } catch (error) { return `budget check failed (fail-closed) — ${error instanceof Error ? error.message : 'metrics query error'}`; }
  }
  if (agent.provider === 'openai-direct') {
    const cap = Number(process.env.OPENAI_MONTHLY_BUDGET_USD) || OPENAI_MONTHLY_BUDGET_DEFAULT_USD;
    try {
      const spent = await openaiMonthlySpendUsd();
      return spent >= cap ? `OpenAI monthly budget exceeded: $${spent.toFixed(2)} ≥ $${cap.toFixed(2)} cap` : null;
    } catch (error) { return `budget check failed (fail-closed) — ${error instanceof Error ? error.message : 'metrics query error'}`; }
  }
  const backend = resolveChatBackend();
  if (backend.provider === 'openrouter') {
    if (!backend.apiKey) return 'OPENROUTER_API_KEY not configured';
    const cap = positiveUsdEnv('OPENROUTER_MONTHLY_BUDGET_USD') ?? OPENROUTER_MONTHLY_BUDGET_DEFAULT_USD;
    try {
      const spent = await openRouterMonthlySpendUsd();
      return spent >= cap ? `OpenRouter monthly budget exceeded: $${spent.toFixed(2)} ≥ $${cap.toFixed(2)} cap` : null;
    } catch (error) { return `OpenRouter budget check failed (fail-closed) — ${error instanceof Error ? error.message : 'metrics query error'}`; }
  }
  void agentId;
  return null;
}

async function runStreamingProvider(prepared: PreparedDispatch, onDelta: (delta: string) => void): Promise<AgentDispatchResult> {
  const { agentId, agent, prompt, dispatchPrompt, history } = prepared;
  const budgetFailure = await guardStreamingBudget(prepared);
  if (budgetFailure) return dispatchFailure(agentId, agent.model, budgetFailure);
  const started = Date.now();

  try {
    if (agent.provider === 'anthropic-direct') {
      if (!process.env.ANTHROPIC_API_KEY) return dispatchFailure(agentId, agent.model, 'ANTHROPIC_API_KEY not configured');
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      // Shared Anthropic tool loop — same implementation as the registry's
      // CEO lane (anthropic-tool-stream.ts), parameterized rather than
      // duplicated: this branch adds history seeding + thinking:disabled.
      const outcome = await runAnthropicToolStream({
        client,
        model: agent.model,
        system: agent.system,
        messages: [...history.slice(-MAX_HISTORY), { role: 'user' as const, content: dispatchPrompt }],
        maxTokens: ANTHROPIC_MAX_TOKENS,
        liveTools: true,
        disableThinking: true,
        onDelta,
      });
      const content = outcome.text;
      const inputTokens = outcome.inputTokens;
      const outputTokens = outcome.outputTokens;
      const model = outcome.model;
      return completeStreamedDispatch(prepared, content, model, outcome, Date.now() - started);
    }

    if (agent.provider === 'openai-direct') {
      if (!process.env.OPENAI_API_KEY) return dispatchFailure(agentId, agent.model, 'OPENAI_API_KEY not configured');
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const outcome = await runResponsesToolRounds({
        input: [...history.slice(-MAX_HISTORY), { role: 'user' as const, content: dispatchPrompt }],
        callModel: async (input) => {
          const stream = await client.responses.create({
            model: agent.model,
            instructions: agent.system,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            input: input as any,
            max_output_tokens: OPENAI_MAX_COMPLETION_TOKENS,
            reasoning: { effort: OPENAI_REASONING_EFFORT },
            tools: toOpenAIResponsesTools(),
            stream: true,
          });
          let text = '';
          let model: string | undefined;
          let inputTokens = 0;
          let outputTokens = 0;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let outputItems: any[] = [];
          let status: string | undefined;
          let incompleteReason: string | undefined;
          for await (const event of stream) {
            if (event.type === 'response.output_text.delta') { text += event.delta; onDelta(event.delta); }
            if (event.type === 'response.completed' || event.type === 'response.incomplete') {
              model = event.response.model;
              inputTokens = event.response.usage?.input_tokens ?? 0;
              outputTokens = event.response.usage?.output_tokens ?? 0;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              outputItems = (event.response.output ?? []) as any[];
              status = event.response.status;
              incompleteReason = event.response.incomplete_details?.reason ?? undefined;
            }
          }
          return { outputItems, text, model, inputTokens, outputTokens, status, incompleteReason };
        },
      });
      return completeStreamedDispatch(prepared, outcome.text, outcome.model ?? agent.model, outcome, Date.now() - started);
    }

    const backend = agent.provider === 'nvidia-direct'
      ? { baseUrl: NVIDIA_URL.replace(/\/chat\/completions$/, ''), apiKey: process.env.NVIDIA_API_KEY ?? '', provider: 'nvidia' as const, headers: {}, resolveModel: () => agent.model }
      : resolveChatBackend();
    if (!backend.apiKey) return dispatchFailure(agentId, agent.model, `${agent.provider === 'nvidia-direct' ? 'NVIDIA_API_KEY' : 'API key'} not configured`);
    const model = backend.resolveModel(agent.model);
    // Universal live-data tools: every OpenAI-compatible lane (OpenRouter,
    // local, NVIDIA) gets the shared web_search / weather / quote tools via
    // the bounded tool loop. Models that ignore tools degrade to a plain
    // reply; a failed tool feeds an error string back, never breaks the turn.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callModel = async (messages: any[]) => {
      const res = await fetch(`${backend.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${backend.apiKey}`, 'Content-Type': 'application/json', ...backend.headers },
        body: JSON.stringify({
          model,
          temperature: agent.temperature,
          max_tokens: agent.provider === 'nvidia-direct' ? NVIDIA_MAX_TOKENS : undefined,
          stream: true,
          stream_options: { include_usage: true },
          tools: toOpenAITools(),
          messages,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: 'no-store',
      });
      if (!res.ok) {
        const message = await res.text();
        if (agent.provider === 'nvidia-direct') throw new Error(classifyNvidiaFailure(res.status, message).reason);
        throw new Error(`${backend.provider} ${res.status}: ${message.slice(0, 160)}`);
      }
      if (!res.body) throw new Error(`${backend.provider} returned no response stream`);
      return consumeOpenAICompatibleStream(res.body, onDelta);
    };
    const outcome = await runToolCallRounds({
      messages: [{ role: 'system' as const, content: agent.system }, ...history.slice(-MAX_HISTORY), { role: 'user' as const, content: dispatchPrompt }],
      callModel,
    });
    return completeStreamedDispatch(prepared, outcome.text, outcome.model ?? model, outcome, Date.now() - started);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'stream dispatch failed';
    await agentLog('error', agentId, `stream dispatch failed — ${reason}`);
    return dispatchFailure(agentId, agent.model, reason);
  }
}

/** SSE shim for the dashboard. The existing server action remains the stable
 * non-streaming entry point for scripts and Settings connectivity tests. */
export async function dispatchAgentStream(rawInput: AgentDispatchInput): Promise<Response> {
  const preparation = await prepareDispatch(rawInput);
  if (!preparation.prepared) return Response.json(preparation.failure, { status: 400 });
  const prepared = preparation.prepared;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      const holdback = MENTOR_AGENT_IDS.has(prepared.agentId) ? new LifeContextProposalHoldback() : null;
      try {
        const result = await runStreamingProvider(prepared, (delta) => {
          const visible = holdback ? holdback.push(delta) : delta;
          if (visible) send({ type: 'delta', text: visible });
        });
        const tail = holdback?.flush();
        if (tail) send({ type: 'delta', text: tail });
        send({ type: 'done', ...result });
      } catch (error) {
        send({ type: 'error', error: error instanceof Error ? error.message : 'dispatch failed' });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' } });
}

function currentUtcMonthStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function positiveUsdEnv(name: string): number | null {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

async function openRouterMonthlySpendUsd(): Promise<number> {
  const snapshot = await getSpendSnapshotSince(currentUtcMonthStartIso());
  const byModelCost = snapshot.byModelCostUsd ?? {};
  return Object.entries(byModelCost).reduce((sum, [model, cost]) => {
    if (model.startsWith('claude') || model === 'converse-budget-gate') return sum;
    return sum + cost;
  }, 0);
}

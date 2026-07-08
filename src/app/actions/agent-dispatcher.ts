'use server';

// Multi-tier OpenRouter brain dispatcher. Server Action only: the API key
// never leaves this module, and every invocation is gated on the same
// operator session cookie the middleware enforces (server actions are
// publicly invocable POST endpoints — session validation here is mandatory,
// not optional).
import { cookies } from 'next/headers';
import { z } from 'zod';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth/session';
import { BRAIN_IDS, BRAIN_MATRIX, type BrainId } from '@/lib/agents/brain-matrix';
import { agentLog } from '@/lib/hermes/hermes-logger';
import { getAdminClient } from '@/lib/supabase/admin';
import { extractTradeParams, buildStagedOrder, persistStagedOrder } from '@/lib/trading/stage';
import { getActivePortfolioBalance } from '@/lib/market/portfolio';
import { publishAgentEvent } from '@/lib/omnigent/bridge';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_HISTORY = 24;
const CODE_FENCE = /```/;

export type AgentId = BrainId;

const DispatchSchema = z.object({
  agentId: z.enum(BRAIN_IDS),
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
}

interface OpenRouterResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

async function assertOperatorSession(): Promise<void> {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) throw new Error('DASHBOARD_PASSWORD not configured');
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await verifySessionToken(token, password))) {
    throw new Error('Unauthorized: valid operator session required');
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
          await agentLog('success', agentId, `thesis staged → ${staged.underlying} ${staged.option_type} ${staged.strike} (E=${staged.expectancy.toFixed(2)}R, awaiting approval)`);
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

export async function dispatchAgent(rawInput: AgentDispatchInput): Promise<AgentDispatchResult> {
  const fail = (agentId: AgentId, modelUsed: string, error: string): AgentDispatchResult => ({
    agentId,
    modelUsed,
    content: '',
    timestamp: new Date().toISOString(),
    error,
  });

  const parsed = DispatchSchema.safeParse(rawInput);
  if (!parsed.success) {
    return fail('HERMES', 'none', `invalid dispatch payload: ${parsed.error.issues[0]?.message ?? 'validation failed'}`);
  }
  const { agentId, prompt, history } = parsed.data;
  const agent = BRAIN_MATRIX[agentId];

  try {
    await assertOperatorSession();
  } catch (err) {
    return fail(agentId, agent.model, err instanceof Error ? err.message : 'session check failed');
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return fail(agentId, agent.model, 'OPENROUTER_API_KEY not configured');

  const messages = [
    { role: 'system' as const, content: agent.system },
    ...history.slice(-MAX_HISTORY),
    { role: 'user' as const, content: prompt },
  ];

  const t0 = Date.now();
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:9002',
        'X-Title': 'My Agent Factory',
      },
      body: JSON.stringify({
        model: agent.model,
        temperature: agent.temperature,
        messages,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    });
    const latencyMs = Date.now() - t0;

    const data = (await res.json().catch(() => ({}))) as OpenRouterResponse;
    if (!res.ok) {
      const reason = `OpenRouter ${res.status}: ${data.error?.message ?? 'request failed'}`;
      await agentLog('error', agentId, `dispatch failed after ${latencyMs}ms — ${reason}`);
      return fail(agentId, agent.model, reason);
    }

    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      await agentLog('error', agentId, `dispatch failed after ${latencyMs}ms — empty completion`);
      return fail(agentId, agent.model, 'OpenRouter returned an empty completion');
    }

    await agentLog('success', agentId, `dispatch completed in ${latencyMs}ms · ${agent.model}`);
    const materialized = await materializeArtifacts(agentId, prompt, content, agent.model);

    publishAgentEvent({
      kind: 'agent.task_completed',
      agentId,
      taskId: null,
      summary: `${prompt.slice(0, 120)} → ${content.slice(0, 160)}`,
      ts: Date.now(),
    });

    return {
      agentId,
      modelUsed: agent.model,
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
    return fail(agentId, agent.model, reason);
  }
}

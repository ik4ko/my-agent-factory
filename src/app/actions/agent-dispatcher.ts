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

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_HISTORY = 24;

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

export interface AgentDispatchResult {
  agentId: AgentId;
  modelUsed: string;
  content: string;
  timestamp: string;
  /** Present only on failure; content is '' in that case. */
  error?: string;
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

    const data = (await res.json().catch(() => ({}))) as OpenRouterResponse;
    if (!res.ok) {
      return fail(agentId, agent.model, `OpenRouter ${res.status}: ${data.error?.message ?? 'request failed'}`);
    }

    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      return fail(agentId, agent.model, 'OpenRouter returned an empty completion');
    }

    return {
      agentId,
      modelUsed: agent.model,
      content,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    const reason =
      err instanceof Error && err.name === 'TimeoutError'
        ? `request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
        : err instanceof Error
          ? err.message
          : 'dispatch failed';
    return fail(agentId, agent.model, reason);
  }
}

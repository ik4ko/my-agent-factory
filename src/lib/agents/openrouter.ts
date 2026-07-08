// Server-side OpenRouter completion against a brain-matrix lane. Used by
// background channels (SMS/phone command core) that carry their own
// transport-level auth and can't present an operator session cookie — the
// interactive path stays on the session-gated dispatchAgent server action.
// Server-only: never import from client components.
import { BRAIN_MATRIX, type BrainId } from './brain-matrix';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const TIMEOUT_MS = 45_000;

export interface BrainCompletion {
  content: string | null;
  model: string;
  error?: string;
}

export async function completeWithBrain(
  agentId: BrainId,
  prompt: string,
  opts: { maxChars?: number } = {}
): Promise<BrainCompletion> {
  const agent = BRAIN_MATRIX[agentId];
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { content: null, model: agent.model, error: 'OPENROUTER_API_KEY not configured' };

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
        messages: [
          { role: 'system', content: agent.system },
          { role: 'user', content: prompt.slice(0, 4_000) },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    const data = (await res.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    if (!res.ok) {
      return { content: null, model: agent.model, error: `OpenRouter ${res.status}: ${data.error?.message ?? 'request failed'}` };
    }
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      return { content: null, model: agent.model, error: 'empty completion' };
    }
    return { content: opts.maxChars ? content.slice(0, opts.maxChars) : content, model: agent.model };
  } catch (err) {
    return {
      content: null,
      model: agent.model,
      error: err instanceof Error && err.name === 'TimeoutError' ? 'request timed out' : err instanceof Error ? err.message : 'request failed',
    };
  }
}

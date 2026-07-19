/**
 * Chat-backend resolution — the single place that decides where
 * OpenAI-compatible chat traffic goes.
 *
 * Default: OpenRouter. Setting AI_LOCAL_BASE_URL reroutes every
 * OpenRouter-lane call (AgentRegistry helpers + the brain-matrix dispatcher)
 * to a local OpenAI-compatible server — LM Studio, Ollama, vLLM,
 * llama.cpp-server, etc. — without touching any call site.
 *
 * Environment contract:
 *   AI_LOCAL_BASE_URL   e.g. http://127.0.0.1:1234/v1 (LM Studio) or
 *                       http://127.0.0.1:11434/v1 (Ollama). Must be the /v1
 *                       root; `/chat/completions` is appended by callers.
 *   AI_LOCAL_API_KEY    optional — most local servers ignore auth; a
 *                       placeholder bearer token is sent when unset.
 *   AI_LOCAL_MODEL      optional — forces every request to this model id
 *                       (local servers serve their own model names, not
 *                       OpenRouter slugs). When unset, the lane's configured
 *                       slug is passed through verbatim.
 *   OPENROUTER_BASE_URL optional override of the hosted default.
 *
 * Request/response contract expected of a local server (non-streaming):
 *   POST {baseUrl}/chat/completions
 *     headers: Authorization: Bearer <key>, Content-Type: application/json
 *     body:    { model, max_tokens?, temperature?, messages: [{role, content}] }
 *   response: { choices: [{ message: { content: string } }],
 *               usage?: { prompt_tokens?, completion_tokens? } }
 *
 * The Anthropic-direct and OpenAI-direct lanes are NOT routed here — their
 * official SDKs already honor ANTHROPIC_BASE_URL / OPENAI_BASE_URL for the
 * same purpose.
 */

export interface ChatBackend {
  /** What actually serves the call — used for telemetry and gating. */
  provider: 'openrouter' | 'local';
  /** OpenAI-compatible /v1 root, no trailing slash. */
  baseUrl: string;
  /** Bearer token to send (placeholder for keyless local servers). */
  apiKey: string | null;
  /** Extra headers (OpenRouter attribution; empty for local). */
  headers: Record<string, string>;
  /** Maps a lane's configured model slug to what this backend serves. */
  resolveModel(model: string): string;
}

const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_HEADERS: Record<string, string> = {
  'HTTP-Referer': 'http://localhost:9002',
  'X-Title': 'My Agent Factory',
};

function trimBase(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** Resolved at CALL time, never cached at module load, so env changes
 *  (and tests) take effect without a rebuild. */
export function resolveChatBackend(): ChatBackend {
  const local = process.env.AI_LOCAL_BASE_URL?.trim();
  if (local) {
    const modelOverride = process.env.AI_LOCAL_MODEL?.trim();
    return {
      provider: 'local',
      baseUrl: trimBase(local),
      // Local servers commonly accept any bearer; send a placeholder so the
      // Authorization header is always well-formed.
      apiKey: process.env.AI_LOCAL_API_KEY?.trim() || 'local-no-key',
      headers: {},
      resolveModel: (model) => modelOverride || model,
    };
  }
  return {
    provider: 'openrouter',
    baseUrl: trimBase(process.env.OPENROUTER_BASE_URL || OPENROUTER_DEFAULT_BASE_URL),
    apiKey: process.env.OPENROUTER_API_KEY?.trim() || null,
    headers: OPENROUTER_HEADERS,
    resolveModel: (model) => model,
  };
}

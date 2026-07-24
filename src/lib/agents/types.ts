/**
 * Federated Brain Network — agent contract (Phase 9 registry refactor).
 *
 * A FederatedAgent is a named brain bound to one provider + model. All LLM
 * invocations in the codebase route through `think()`; callers never touch
 * provider SDKs directly.
 */

export type AgentProvider = 'anthropic' | 'openai' | 'nous' | 'openrouter' | 'local';

export interface ThinkInput {
  system: string;
  prompt: string;
  maxTokens?: number;
  /** Defaults to `auto`: AgentRegistry budget-gates and records usage.
   *  Use `external` only when the caller already gates + records this call. */
  ledger?: {
    mode?: 'auto' | 'external' | 'off';
    taskId?: string | null;
    agentId?: string | null;
    detail?: string;
  };
  /** Streaming hook — fires per text delta when the provider streams
   *  (Anthropic), or once with the full text when it doesn't. */
  onDelta?: (text: string) => void;
  /** Enable the shared live-data tools (web search / weather / stock quote —
   *  see src/lib/tools/live-tools.ts). The provider adapter runs the
   *  tool-call loop; results exist only inside this request. */
  liveTools?: boolean;
}

export interface ThinkResult {
  text: string;
  /** Model that actually ran (fallbacks report the fallback model). */
  model: string;
  /** Provider that actually ran (fallbacks report the fallback provider). */
  provider: AgentProvider;
  /** UNCACHED prompt tokens. Anthropic reports cache traffic separately. */
  inputTokens: number;
  outputTokens: number;
  /** `cache_creation_input_tokens` (Anthropic lanes only; 0 elsewhere). */
  cacheWriteTokens?: number;
  /** `cache_read_input_tokens` (Anthropic lanes only; 0 elsewhere). */
  cacheReadTokens?: number;
  latencyMs: number;
}

export interface FederatedAgent {
  /** Registry name, e.g. 'Hermes'. */
  readonly name: string;
  /** CONFIGURED provider (the runtime may fall back if its key is absent). */
  readonly provider: AgentProvider;
  readonly model: string;
  think(input: ThinkInput): Promise<ThinkResult>;
}

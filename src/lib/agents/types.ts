/**
 * Federated Brain Network — agent contract (Phase 9 registry refactor).
 *
 * A FederatedAgent is a named brain bound to one provider + model. All LLM
 * invocations in the codebase route through `think()`; callers never touch
 * provider SDKs directly.
 */

export type AgentProvider = 'anthropic' | 'openai' | 'nous' | 'openrouter';

export interface ThinkInput {
  system: string;
  prompt: string;
  maxTokens?: number;
  /** Streaming hook — fires per text delta when the provider streams
   *  (Anthropic), or once with the full text when it doesn't. */
  onDelta?: (text: string) => void;
}

export interface ThinkResult {
  text: string;
  /** Model that actually ran (fallbacks report the fallback model). */
  model: string;
  /** Provider that actually ran (fallbacks report the fallback provider). */
  provider: AgentProvider;
  inputTokens: number;
  outputTokens: number;
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

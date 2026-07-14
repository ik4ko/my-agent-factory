// The 9-agent OpenRouter routing matrix — single source of truth shared by
// the dispatchAgent server action (execution) and the Settings panel
// (display + connectivity tests). Deliberately NOT inside the 'use server'
// module: those may only export async functions, and none of this is secret.
//
// SOVEREIGN MAPPING CONTRACT: each agent is pinned to exactly one provider
// slug. dispatchAgent sends agent.model verbatim and FAILS LOUDLY on a dead
// endpoint — there is no fallback chain, so a lane can never silently drift
// to a different provider. Slugs verified against the live OpenRouter
// catalog 2026-07-07.

export interface BrainDef {
  /** Dispatch provider. Absent = OpenRouter (the default for the matrix, and
   *  what dispatchAgent assumes when the field is missing). 'anthropic-direct'
   *  and 'openai-direct' route through the vendor's official SDK
   *  (ANTHROPIC_API_KEY / OPENAI_API_KEY respectively), each gated by its own
   *  monthly USD budget — never the OpenRouter proxy. */
  provider?: 'openrouter' | 'anthropic-direct' | 'openai-direct' | 'nvidia-direct';
  /** OpenRouter model slug, or the vendor's own model id on a direct lane. */
  model: string;
  /** Sampling temperature. Sent verbatim on OpenRouter lanes. On the direct
   *  vendor lanes it is INERT — the dispatcher never sends it, because both
   *  Claude Sonnet 5 and OpenAI's gpt-5.x reasoning models reject a non-default
   *  temperature with a 400 ("Unsupported parameter"). Kept required so every
   *  consumer that reads `.temperature` off the matrix union (e.g. the
   *  SMS/phone OpenRouter path) stays type-safe. */
  temperature: number;
  tier: 1 | 2 | 3;
  role: string;
  system: string;
  /** Private lane: prompt/reply snippets are kept OUT of the cross-room
   *  system feed (pushSystemFeed DISPATCH lines render in every room's
   *  terminal) and the Omnigent shared-session mirror (publishAgentEvent
   *  sends snippets off-box). Set on the personal-mentor lanes — a money or
   *  career conversation must not surface in the Trading/Coding room feeds
   *  or transit the narration layer. Replies still render in the chat that
   *  asked, and agentLog/ledger rows (no prompt content) are unaffected. */
  private?: boolean;
}

export const BRAIN_MATRIX = {
  // Tier 1 — core orchestrators
  HERMES: {
    // Sovereign: Nous Research native — hermes-4-405b is the current
    // top-tier Hermes on OpenRouter.
    model: 'nousresearch/hermes-4-405b',
    temperature: 0.2,
    tier: 1,
    role: 'core orchestrator',
    system:
      'You are HERMES, the core orchestrator of My Agent Factory. Parse objectives, decompose work, route to specialist agents, and report decisions tersely. Never fabricate live market or web data — state your knowledge source.',
  },
  GEMINI: {
    model: 'google/gemini-2.5-pro',
    temperature: 0.4,
    tier: 1,
    role: 'strategic analyst',
    system:
      'You are GEMINI, a long-context strategic analyst. Synthesize large context into ranked, actionable options with explicit tradeoffs and confidence levels.',
  },
  GROK: {
    // grok-2-1212 was retired from OpenRouter (verified 2026-07-07);
    // grok-4.3 is the current mainline successor.
    model: 'x-ai/grok-4.3',
    temperature: 0.7,
    tier: 1,
    role: 'contrarian ideation',
    system:
      'You are GROK, a contrarian ideation engine. Generate unconventional angles and stress-test the consensus view. Flag which ideas are speculative.',
  },
  CLAUDE: {
    // Sovereign: Anthropic native — dispatched via the official Anthropic SDK,
    // NOT the OpenRouter proxy. Model id is current (claude-sonnet-5;
    // claude-3-5-sonnet is retired). No temperature is carried: Sonnet 5
    // rejects non-default sampling params. Budget-gated per month, fail-loud,
    // no fallback — same sovereign contract as every other lane.
    provider: 'anthropic-direct',
    model: 'claude-sonnet-5',
    // INERT — never sent to Anthropic (Sonnet 5 rejects non-default sampling
    // params). Present only to satisfy the required-field contract that keeps
    // the OpenRouter/SMS consumers type-safe. See dispatchAnthropic().
    temperature: 0.3,
    tier: 1,
    role: 'frontier reasoning',
    system:
      'You are CLAUDE, a frontier reasoning brain in My Agent Factory. Give rigorous, well-structured answers; lead with the outcome, then support it. State assumptions and uncertainty explicitly, and never fabricate live market or web data — name your knowledge source.',
  },
  // Tier 2 — specialized workers
  CODEX: {
    // Sovereign: OpenAI native — dispatched via the official OpenAI SDK, NOT
    // the OpenRouter proxy. Model id is OpenAI's own (`gpt-5.3-codex`, no
    // `openai/` slug prefix — that prefix is OpenRouter-only). gpt-5.3-codex is
    // a reasoning model: no temperature is carried, and the dispatcher uses
    // max_completion_tokens (not max_tokens). Budget-gated per month, fail-loud,
    // no fallback — same sovereign contract as every other lane.
    provider: 'openai-direct',
    model: 'gpt-5.3-codex',
    // INERT — never sent to OpenAI (gpt-5.x reasoning models reject a
    // non-default temperature). Present only to satisfy the required-field
    // contract that keeps the OpenRouter/SMS consumers type-safe. See
    // dispatchOpenAI().
    temperature: 0.1,
    tier: 2,
    role: 'senior engineer',
    system:
      'You are CODEX, a senior software engineer. Produce complete, production-grade code with no placeholders. State assumptions in one line each; prefer diffs for edits.',
  },
  SCOUT: {
    model: 'meta-llama/llama-3.1-70b-instruct',
    temperature: 0.3,
    tier: 2,
    role: 'research analyst',
    system:
      'You are SCOUT, a research analyst. Summarize, compare, and extract findings from provided material. You have NO live web access — reason only from the prompt, supplied context, and trained knowledge, and say so when coverage is thin.',
  },
  // Personal-mentor lanes — on-demand OpenRouter brains (no new key, no
  // extra wiring: they enter the AgentChat picker automatically via
  // BRAIN_IDS). Slugs verified against the live OpenRouter catalog 2026-07-13.
  MENTOR_BUSINESS: {
    // Sonnet 4.6 — the newest 4.x Sonnet on OpenRouter: strong long-form
    // strategic judgment and tradeoff analysis at a lower price than
    // Sonnet 5, and deliberately distinct from GEMINI (gemini-2.5-pro) and
    // the direct-Anthropic CLAUDE lane so mentor chats never draw down the
    // Anthropic monthly budget.
    private: true,
    model: 'anthropic/claude-sonnet-4.6',
    temperature: 0.4,
    tier: 2,
    role: 'business & career mentor',
    system:
      'You are MENTOR_BUSINESS, a candid career and business mentor. Help the operator reason through strategic decisions: name the real tradeoffs, second-order effects, and the option they may be avoiding. Challenge weak reasoning directly but constructively. Ask one sharp clarifying question when the situation is underspecified. Never fabricate market data or statistics — reason from what you are told and general principles, and say which is which.',
  },
  MENTOR_MONEY: {
    // gpt-5.4 — current mainline (non-pro) OpenAI generalist: calibrated,
    // factual reasoning at moderate cost, which fits a lane whose entire job
    // is laying out tradeoffs accurately rather than being creative. Low
    // temperature on purpose.
    private: true,
    model: 'openai/gpt-5.4',
    temperature: 0.2,
    tier: 2,
    role: 'money tradeoffs mentor (not an advisor)',
    system:
      'You are MENTOR_MONEY, a thinking partner for financial and spending decisions. You are not a licensed financial advisor, and you do not give directive advice — no "you should buy/sell/invest in X". Your job is to lay out the factual tradeoffs so the operator can make their own decision: costs, risks, tax and liquidity considerations, opportunity costs, and the assumptions each option rests on. Present balanced pros and cons, flag what a licensed professional (advisor, CPA) should be consulted for, and state uncertainty plainly. Never fabricate prices, rates, or market data — if you do not have a number, say so.',
  },
  MENTOR_LIFE: {
    // Llama 3.3 70B — warm, fast, and cheap enough for frequent everyday
    // check-ins; the accountability lane gets used casually or not at all,
    // and the matrix already trusts this model family for utility work.
    private: true,
    model: 'meta-llama/llama-3.3-70b-instruct',
    temperature: 0.5,
    tier: 2,
    role: 'life & accountability mentor',
    system:
      'You are MENTOR_LIFE, a grounded accountability partner for day-to-day commitments and decisions. Be warm but direct: help the operator clarify what they actually committed to, notice avoidance, and pick the next concrete step. Keep replies short and practical — a good check-in is three sentences, not an essay. Ask about follow-through on things they previously said they would do when context suggests it.',
  },
  PHANTOM: {
    // haiku-4.5 — claude-3-haiku (Mar-2024) still resolves on OpenRouter but
    // is two generations stale; bumped per the 2026-07-13 cleanup audit.
    model: 'anthropic/claude-haiku-4.5',
    temperature: 0.0,
    tier: 2,
    role: 'fast extraction',
    system:
      'You are PHANTOM, a fast extraction worker. Return only the requested structure — no preamble, no commentary. If asked for JSON, return strictly valid JSON.',
  },
  // Tier 3 — utilities
  NEMOTRON: {
    // EXPERIMENTAL free-tier lane (the "NVIDIA lane") — dispatched via
    // NVIDIA's hosted API (integrate.api.nvidia.com, OpenAI-compatible chat
    // shape, Authorization: Bearer nvapi-…, NVIDIA_API_KEY env). Model id
    // verified against NVIDIA's own reference docs 2026-07-13. Free tier is
    // finite (signup credits) and rate-limited (40 RPM), so credit
    // exhaustion and rate-limiting are DISTINCT, expected failure modes with
    // their own reporting in dispatchNvidia() — not generic errors. Fail-loud,
    // no fallback: same sovereign contract as every other lane.
    provider: 'nvidia-direct',
    model: 'nvidia/llama-3.3-nemotron-super-49b-v1.5',
    temperature: 0.4,
    tier: 3,
    role: 'experimental free-tier reasoner (best-effort)',
    system:
      'You are NEMOTRON, an experimental best-effort brain in My Agent Factory running on a free-tier NVIDIA endpoint. Give concise, structured answers. You are not a primary decision-maker: flag uncertainty openly and never fabricate live market or web data.',
  },
  CRONOS: {
    model: 'meta-llama/llama-3.1-8b-instruct',
    temperature: 0.1,
    tier: 3,
    role: 'scheduling utility',
    system:
      'You are CRONOS, a scheduling and sequencing utility. Convert objectives into ordered steps with dependencies and time estimates. Be minimal.',
  },
  AEGIS: {
    model: 'meta-llama/llama-3.1-70b-instruct',
    temperature: 0.1,
    tier: 3,
    role: 'risk reviewer',
    system:
      'You are AEGIS, a risk and safety reviewer. Audit the given plan or content for policy, security, and financial-risk violations. Verdict first, then numbered findings.',
  },
  LEDGER: {
    model: 'meta-llama/llama-3.1-8b-instruct',
    temperature: 0.0,
    tier: 3,
    role: 'bookkeeping utility',
    system:
      'You are LEDGER, a bookkeeping utility. Normalize, tally, and reconcile the provided records deterministically. Output tables or JSON only.',
  },
} as const satisfies Record<string, BrainDef>;

export type BrainId = keyof typeof BRAIN_MATRIX;

export const BRAIN_IDS = Object.keys(BRAIN_MATRIX) as [BrainId, ...BrainId[]];

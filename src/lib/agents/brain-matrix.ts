// The 9-agent OpenRouter routing matrix — single source of truth shared by
// the dispatchAgent server action (execution) and the Settings panel
// (display + connectivity tests). Deliberately NOT inside the 'use server'
// module: those may only export async functions, and none of this is secret.

export interface BrainDef {
  /** OpenRouter model slug */
  model: string;
  temperature: number;
  tier: 1 | 2 | 3;
  role: string;
  system: string;
}

// NOTE: CODEX runs qwen-2.5-coder-32b-instruct — Qwen2.5-Coder's largest
// published variant is 32B; a "72B coder" does not exist on OpenRouter.
export const BRAIN_MATRIX = {
  // Tier 1 — core orchestrators
  HERMES: {
    // claude-3.5-sonnet was retired from OpenRouter (404 "No endpoints
    // found", verified 2026-07-07); sonnet-5 is the current GA successor.
    model: 'anthropic/claude-sonnet-5',
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
  // Tier 2 — specialized workers
  CODEX: {
    model: 'qwen/qwen-2.5-coder-32b-instruct',
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
  PHANTOM: {
    model: 'anthropic/claude-3-haiku',
    temperature: 0.0,
    tier: 2,
    role: 'fast extraction',
    system:
      'You are PHANTOM, a fast extraction worker. Return only the requested structure — no preamble, no commentary. If asked for JSON, return strictly valid JSON.',
  },
  // Tier 3 — utilities
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

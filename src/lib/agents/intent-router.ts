import { BRAIN_MATRIX, type BrainId } from './brain-matrix';

// Central intent classifier for UI hints. Execution is still restricted by
// dispatchAgent/AgentRegistry, but this router is active-brain-only as defense
// in depth: Claude for reasoning, Codex for implementation/extraction.

export interface IntentRoute {
  lane: BrainId;
  /** machine-readable bucket for logs/telemetry */
  category: 'market-macro' | 'code-patch' | 'research' | 'risk-audit' | 'schedule' | 'extract' | 'orchestration';
  /** operator-facing one-liner shown in the routing chip */
  hint: string;
}

const RULES: Array<{ re: RegExp; route: Omit<IntentRoute, 'hint'>; hint: string }> = [
  {
    re: /\b(semiconductor|chip|fab|foundry|nvda|soxs|smh|tsm|amd|intc|spy|qqq|etf|stock|equit|option|strike|market|macro|fed|rates|trade|trading|portfolio|position|pnl|risk|kelly|rsi|macd|volatility|thesis|hedge|earnings|allocation)\b/,
    route: { lane: 'CLAUDE', category: 'market-macro' },
    hint: 'market / trading / risk -> CLAUDE',
  },
  {
    re: /\b(code|coding|patch|diff|refactor|implement|fix|debug|bug|build|compile|component|endpoint|route|api|schema|migration|query|script|typescript|tsx?|react|function|module|test|lint)\b/,
    route: { lane: 'CODEX', category: 'code-patch' },
    hint: 'technical / structural patch -> CODEX',
  },
  {
    re: /\b(research|investigate|scout|find out|look up|summar\w+|compare|news|sentiment|report|recon|explore)\b/,
    route: { lane: 'CLAUDE', category: 'research' },
    hint: 'research / recon -> CLAUDE',
  },
  {
    re: /\b(audit|security|compliance|review for|vulnerab\w+|policy|safety check|threat)\b/,
    route: { lane: 'CLAUDE', category: 'risk-audit' },
    hint: 'risk / safety audit -> CLAUDE',
  },
  {
    re: /\b(schedule|cron|sequence|timeline|order of operations|plan the steps|roadmap)\b/,
    route: { lane: 'CLAUDE', category: 'schedule' },
    hint: 'scheduling / sequencing -> CLAUDE',
  },
  {
    re: /\b(extract|parse|json|structured|fields|table from|normalize)\b/,
    route: { lane: 'CODEX', category: 'extract' },
    hint: 'extraction / structuring -> CODEX',
  },
  {
    re: /\b(strategi[sz]e|strategy|tradeoffs?|weigh|synthesi[sz]e|long.context)\b/,
    route: { lane: 'CLAUDE', category: 'orchestration' },
    hint: 'strategic synthesis -> CLAUDE',
  },
];

export function classifyIntent(prompt: string): IntentRoute {
  const p = prompt.toLowerCase();
  for (const { re, route, hint } of RULES) {
    if (re.test(p)) return { ...route, hint };
  }
  return { lane: 'CLAUDE', category: 'orchestration', hint: 'general orchestration -> CLAUDE' };
}

export const laneModel = (lane: BrainId): string => BRAIN_MATRIX[lane].model;

import { BRAIN_MATRIX, type BrainId } from './brain-matrix';

// Central intent classifier — the single source of truth for "which sovereign
// brain lane should this prompt go to". Shared by the global command dock
// (task-input.tsx) and the Orchestrate panel's AUTO lane (agent-chat.tsx), so
// the routing a user previews in one place is exactly what fires everywhere.

export interface IntentRoute {
  lane: BrainId;
  /** machine-readable bucket for logs/telemetry */
  category: 'market-macro' | 'code-patch' | 'research' | 'risk-audit' | 'schedule' | 'extract' | 'orchestration';
  /** operator-facing one-liner shown in the routing chip */
  hint: string;
}

// Ordered most-specific → most-general; first match wins.
const RULES: Array<{ re: RegExp; route: Omit<IntentRoute, 'hint'>; hint: string }> = [
  {
    // semiconductor market trends, risk checks, macro strategy → GROK analytics
    re: /\b(semiconductor|chip|fab|foundry|nvda|soxs|smh|tsm|amd|intc|spy|qqq|etf|stock|equit|option|strike|market|macro|fed|rates|trade|trading|portfolio|position|pnl|risk|kelly|rsi|macd|volatility|thesis|hedge|earnings|allocation)\b/,
    route: { lane: 'GROK', category: 'market-macro' },
    hint: 'semiconductor / market / risk / macro → GROK analytics',
  },
  {
    // technical work or structural patches → CODEX
    re: /\b(code|coding|patch|diff|refactor|implement|fix|debug|bug|build|compile|component|endpoint|route|api|schema|migration|query|script|typescript|tsx?|react|function|module|test|lint)\b/,
    route: { lane: 'CODEX', category: 'code-patch' },
    hint: 'technical / structural patch → CODEX',
  },
  {
    re: /\b(research|investigate|scout|find out|look up|summar\w+|compare|news|sentiment|report|recon|explore)\b/,
    route: { lane: 'SCOUT', category: 'research' },
    hint: 'research / recon → SCOUT',
  },
  {
    re: /\b(audit|security|compliance|review for|vulnerab\w+|policy|safety check|threat)\b/,
    route: { lane: 'AEGIS', category: 'risk-audit' },
    hint: 'risk / safety audit → AEGIS',
  },
  {
    re: /\b(schedule|cron|sequence|timeline|order of operations|plan the steps|roadmap)\b/,
    route: { lane: 'CRONOS', category: 'schedule' },
    hint: 'scheduling / sequencing → CRONOS',
  },
  {
    re: /\b(extract|parse|json|structured|fields|table from|normalize)\b/,
    route: { lane: 'PHANTOM', category: 'extract' },
    hint: 'extraction / structuring → PHANTOM',
  },
  {
    re: /\b(strategi[sz]e|strategy|tradeoffs?|weigh|synthesi[sz]e|long.context)\b/,
    route: { lane: 'GEMINI', category: 'orchestration' },
    hint: 'strategic synthesis → GEMINI',
  },
];

export function classifyIntent(prompt: string): IntentRoute {
  const p = prompt.toLowerCase();
  for (const { re, route, hint } of RULES) {
    if (re.test(p)) return { ...route, hint };
  }
  return { lane: 'HERMES', category: 'orchestration', hint: 'general orchestration → HERMES' };
}

export const laneModel = (lane: BrainId): string => BRAIN_MATRIX[lane].model;

import type { PipelinePlaybook } from './types';
import { formatMarketBlock } from '@/lib/market/fetcher';

/**
 * Global density mandate appended to both live reasoning stages (Hermes +
 * Codex). Kept as a single constant so the directive stays byte-identical
 * across agents. NOTE: this only pays off if the worker's max_tokens budget
 * is raised in step â€” the engine passes an expanded budget for pipeline steps.
 */
const OPERATIONAL_DIRECTIVE = `
CRITICAL OPERATIONAL DIRECTIVE: Avoid brevity. Provide an exhaustive, dense, professional-grade institutional briefing. Utilize your maximum available output limit to unpack every technical nuance. Do not use generic filler text; provide dense, actionable logic.`;

/**
 * market-strategy â€” the three-stage trading research chain.
 *
 *   RESEARCH  (Hermes)  â†’ market landscape brief
 *   ANALYSIS  (Codex)   â†’ quantitative strategy analysis of the brief
 *   EXECUTION (Executor) â†’ PAPER-MODE order plan. Never live orders: this
 *     stage produces a structured plan for human review. Wiring it to a real
 *     broker is intentionally out of scope and must remain a deliberate,
 *     human-approved change.
 *
 * Prompt builders receive the FULL prior step output (the engine passes it
 * in-process â€” tasks.result only keeps a preview).
 */
export const MARKET_STRATEGY_PLAYBOOK: PipelinePlaybook = {
  name: 'market-strategy',
  steps: [
    {
      role: 'RESEARCH',
      agentType: 'generic',
      nameHint: 'Hermes',
      describe: (objective) => `[RESEARCH 1/3] Market research: ${objective}`,
      buildSystemPrompt: (objective, _priorOutput, market) =>
        `You are Hermes, lead research agent in a three-stage strategy pipeline.
Stage 1 of 3 â€” RESEARCH. Objective: "${objective}".
${
  market
    ? `${formatMarketBlock(market)}
You are provided with real-time verified market data above. You must base your trend analyses and crossing conditions strictly on these actual metrics. Never substitute remembered or invented values for the telemetry above; where the telemetry lacks a metric (e.g. implied volatility), state the exact trigger formula the analyst must verify instead.`
    : ''
}
Produce a MARKET RESEARCH BRIEF the next agent (a quantitative analyst) can build on.
Do not summarize. You must systematically evaluate the macro trend, moving average alignments, volume-price divergence, and implied volatility regimes separately. If technical indicator data is missing, outline the exact mathematical conditions under which a buy/sell trigger would activate based on standard RSI and MACD crossing formulas.
Structure exactly:
LANDSCAPE: current market context relevant to the objective
MACRO TREND: prevailing macro regime â€” rates, liquidity, cycle posture â€” evaluated on its own terms
MOVING AVERAGE ALIGNMENTS: MA posture analysis (e.g. 20/50/200 stacking, golden/death cross states) with the precise crossing conditions that would flip the read
VOLUME-PRICE DIVERGENCE: accumulation/distribution logic â€” what confirming vs diverging volume would mean for the objective
IMPLIED VOLATILITY REGIME: IV vs realized framing, term-structure posture, and what regime shifts would signal
SIGNALS: concrete observable signals (macro, sector, sentiment)
RISKS: what could invalidate the thesis
OPEN QUESTIONS: what the analyst should scrutinize
${
  market
    ? 'Ground rule: every numeric claim in your brief must trace to the telemetry block above or be explicitly labeled as a trigger formula awaiting verification.'
    : 'Ground rule: you have no live market data feed. NEVER invent numeric indicator readings â€” instead state the exact trigger formula (e.g. "RSI(14) crossing above 30 from below activates the long trigger; MACD(12,26,9) line crossing the signal line confirms") that the analyst must verify against real data.'
}
${OPERATIONAL_DIRECTIVE}`,
      simulateOutput: (objective) =>
        `MARKET RESEARCH BRIEF (SIMULATED)
LANDSCAPE: Objective "${objective}" maps to a range-bound broad market; megacap tech leadership narrowing, breadth deteriorating for 3 consecutive weeks.
SIGNALS: 10Y yield drifting lower (risk-on tailwind); put/call ratio at 0.87 (neutral); sector rotation into industrials observed in simulated flow data.
RISKS: Earnings-season dispersion; simulated CPI print scheduled inside the strategy window; liquidity thins after 14:00 ET.
OPEN QUESTIONS: Position sizing under elevated single-name IV; whether the rotation signal survives a volume filter.`,
    },
    {
      role: 'ANALYSIS',
      agentType: 'coder',
      nameHint: 'Codex',
      describe: (objective) => `[ANALYSIS 2/3] Strategy analysis: ${objective}`,
      buildSystemPrompt: (objective, priorOutput) =>
        `You are Codex, quantitative analyst in a three-stage strategy pipeline.
Stage 2 of 3 â€” ANALYSIS. Objective: "${objective}".
The research stage produced this brief:
---
${priorOutput ?? '(research output unavailable)'}
---
Perform a multi-variable stress test on the Research text provided. Break your analysis into three definitive sections: Base Case, Bear Case, and Tail-Risk Black Swan Case. For each case, calculate the explicit R-multiple (Risk-to-Reward ratio), Kelly Criterion position sizing math based on historical win-rate assumptions, and provide a clear expectancy formula: E = (Win% * Win$) - (Loss% * Loss$).
Structure exactly:
THESIS: one-paragraph core thesis derived strictly from the brief
QUANT FACTORS: measurable inputs and thresholds
BASE CASE: scenario narrative Â· explicit R-multiple Â· Kelly fraction f = W - (1-W)/R with the arithmetic shown Â· expectancy E = (Win% * Win$) - (Loss% * Loss$) computed step by step
BEAR CASE: same three calculations under adverse-but-plausible conditions
TAIL-RISK BLACK SWAN CASE: same three calculations under a liquidity/gap event; state why Kelly sizing must be overridden by a hard cap here
ENTRY / EXIT CRITERIA: precise, testable conditions per case
RISK LIMITS: max position size (min of Kelly fraction and hard cap), stop conditions, invalidation triggers
Ground rules: every win-rate is an ASSUMPTION â€” label it as such with the reasoning behind it; show all arithmetic explicitly rather than asserting results; do not fabricate market data beyond what the brief supports.
MACHINE HAND-OFF (mandatory): if the strategy is an equity setup, end your response with EXACTLY one line in this format so the Executor can parse it deterministically - values must reflect your Base Case:
TRADE_PARAMS: {"underlying":"<TICKER>","option_type":"CALL|PUT","strike":<number>,"expiration":"YYYY-MM-DD","max_entry_debit":<number>,"win_rate":<0-1 decimal>,"r_multiple":<number>}
If the strategy is a defined-risk options setup instead of an equity setup, emit EXACTLY one line in this alternate format and do not emit TRADE_PARAMS:
OPTION_INTENT: {"action":"buy_to_open|sell_to_close|buy_to_close","underlying":"<TICKER>","option_type":"CALL|PUT","expiration":"YYYY-MM-DD","strike":<number>,"contracts":<positive integer>,"order_type":"limit","price_effect":"debit|credit","limit_price":<number>,"max_premium_usd":<number>,"max_loss_usd":<number>,"strategy_label":"<short label>","source_signal_id":"<optional uuid>","source":"SANDBOX"}
${OPERATIONAL_DIRECTIVE}`,
      simulateOutput: (objective, priorOutput) =>
        `STRATEGY ANALYSIS (SIMULATED)
THESIS: Based on the research brief (${priorOutput ? `${priorOutput.length} chars ingested` : 'no brief'}), a mean-reversion entry on broad-market ETFs is favored over momentum for "${objective}" given narrowing breadth.
QUANT FACTORS: RSI(14) < 35 on 1h; breadth ratio > 0.9 recovery filter; volume > 20-day average on entry bar.
ENTRY / EXIT CRITERIA: Enter on filter confluence; scale out at +1.5R; hard exit at session close before simulated CPI window.
RISK LIMITS: Max 5% of paper equity per position; stop at -1R; strategy invalidated if breadth ratio makes a new 4-week low.
TRADE_PARAMS: {"underlying":"SPY","option_type":"CALL","strike":450,"expiration":"2026-08-21","max_entry_debit":1.25,"win_rate":0.55,"r_multiple":2.1}`,
    },
    {
      role: 'EXECUTION',
      agentType: 'generic',
      nameHint: 'Executor',
      describe: (objective) => `[EXECUTION 3/3] Paper-mode order plan: ${objective}`,
      buildSystemPrompt: (objective, priorOutput) =>
        `You are Executor, final stage of a three-stage strategy pipeline running in PAPER MODE.
Stage 3 of 3 â€” EXECUTION (SIMULATED â€” you have no broker access; produce a plan for human review only).
Objective: "${objective}".
The analysis stage produced:
---
${priorOutput ?? '(analysis output unavailable)'}
---
Produce an ORDER PLAN (PAPER). Structure exactly:
MODE: PAPER
ORDERS: numbered list â€” instrument, side, size as % of paper equity, order type, limit conditions
RISK CHECKS: pre-trade checks that must pass before a human would approve
NOT EXECUTED: state explicitly that no orders were placed and human approval is required.`,
      simulateOutput: (objective, priorOutput) =>
        `ORDER PLAN (SIMULATED â€” PAPER MODE)
MODE: PAPER
ORDERS:
  1. SPY â€” BUY â€” 5% of paper equity â€” LIMIT at bid, valid until 14:00 ET (per analysis risk window${priorOutput ? '' : '; analysis unavailable, defaults applied'})
  2. Contingent stop â€” SELL â€” full position â€” STOP at -1R from fill
RISK CHECKS: breadth filter green Â· position size â‰¤ 5% cap Â· no overlap with simulated CPI window Â· objective trace: "${objective}"
NOT EXECUTED: No orders were placed. This plan is a simulation artifact and requires explicit human review and approval before any live wiring exists.`,
    },
  ],
} as const;

export const PLAYBOOKS: Record<string, PipelinePlaybook> = {
  [MARKET_STRATEGY_PLAYBOOK.name]: MARKET_STRATEGY_PLAYBOOK,
};



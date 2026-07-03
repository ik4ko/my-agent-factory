// Dynamic model routing with the 20% Fable-5 network-share cap.
// Pure decision logic over an injected SpendSnapshot — unit-testable, no I/O.
import { modelShare, type SpendSnapshot } from '@/lib/telemetry/token-ledger';

export const MODELS = {
  FABLE: 'claude-fable-5',
  OPUS: 'claude-opus-4-8',
  HAIKU: 'claude-haiku-4-5',
} as const;

export const FABLE_SHARE_CAP = 0.2;
export const MIN_FABLE_PAYLOAD_TOKENS = 2_000;

export type Complexity = 'high-stakes' | 'routine';
export type Transition = 'SEAT' | 'UP' | 'DOWN';

const HIGH_STAKES = /\b(architect(ure)?|migrat(e|ion)|critical|sev[- ]?[01]|debug(ging)?|refactor|schema|rls|security|auth|incident|rollback|data[- ]loss)\b/i;

/** Rough token estimate (~4 chars/token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function classifyComplexity(description: string): Complexity {
  return HIGH_STAKES.test(description) ? 'high-stakes' : 'routine';
}

export interface RouteDecision {
  model: string;
  transition: Transition;
  complexity: Complexity;
  inputTokens: number;
  fableShare: number;
  reason: string;
}

/**
 * SEAT — routine task, default worker model.
 * UP   — high-stakes task escalated to Fable 5.
 * DOWN — Fable candidate forced down to Opus 4.8 (payload < 2k tokens, or
 *        Fable already >20% of 24h network spend).
 */
export function routeModel(description: string, snapshot: SpendSnapshot): RouteDecision {
  const complexity = classifyComplexity(description);
  const inputTokens = estimateTokens(description);
  const fableShare = modelShare(snapshot, MODELS.FABLE);

  if (complexity === 'routine') {
    return {
      model: MODELS.HAIKU,
      transition: 'SEAT',
      complexity,
      inputTokens,
      fableShare,
      reason: 'routine payload — default worker model',
    };
  }

  if (inputTokens < MIN_FABLE_PAYLOAD_TOKENS) {
    return {
      model: MODELS.OPUS,
      transition: 'DOWN',
      complexity,
      inputTokens,
      fableShare,
      reason: `payload ${inputTokens}tok < ${MIN_FABLE_PAYLOAD_TOKENS} — Opus fallback`,
    };
  }

  if (fableShare > FABLE_SHARE_CAP) {
    return {
      model: MODELS.OPUS,
      transition: 'DOWN',
      complexity,
      inputTokens,
      fableShare,
      reason: `fable share ${(fableShare * 100).toFixed(1)}% > ${FABLE_SHARE_CAP * 100}% cap — Opus fallback`,
    };
  }

  return {
    model: MODELS.FABLE,
    transition: 'UP',
    complexity,
    inputTokens,
    fableShare,
    reason: 'high-stakes payload within budget — escalated to Fable 5',
  };
}

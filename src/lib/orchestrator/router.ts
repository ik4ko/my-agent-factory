// Autonomous Lane Router — the traffic cop. Pure heuristics over a spend
// snapshot (cost ↔ intelligence trade), so every branch is unit-testable.
//
//   SEAT  fast validations, cleanup, metadata work, OR any task when Fable
//         spend is near the 20% cap (cap headroom < 10%): burn the cheap lane.
//   DOWN  messy/ambiguous/creative payloads, and high-stakes work too small
//         to justify Fable (< 2k tokens).
//   UP    massive structural planning (high-stakes AND ≥ 2k tokens AND cap
//         headroom) — STAGED: requires human approval before dispatch.
import {
  classifyComplexity,
  estimateTokens,
  MODELS,
  FABLE_SHARE_CAP,
  MIN_FABLE_PAYLOAD_TOKENS,
} from '@/lib/agents/model-router';
import { modelShare, type SpendSnapshot } from '@/lib/telemetry/token-ledger';
import { buildSystemPrompt, type Lane } from '@/lib/orchestrator/prompts';
import type { AgentType } from '@/lib/types/database.types';

export const NEAR_CAP_RATIO = 0.9; // fableShare ≥ 90% of cap == "near cap"

const FAST_VALIDATION =
  /\b(validate|validation|heartbeat|ping|health[- ]?check|lint|format(ting)?|cleanup|clean up|dedupe|normali[sz]e|filter (the )?metadata|metadata filter|syntax)\b/i;
const HIGH_AMBIGUITY =
  /\b(ambiguous|messy|unstructured|free[- ]?form|creative|brainstorm|ideate|scrape[d]?|ocr|hand[- ]?written|inconsistent)\b/i;

export const LANE_MODEL: Record<Lane, string> = {
  SEAT: MODELS.HAIKU,
  DOWN: MODELS.OPUS,
  UP: MODELS.FABLE,
};

export interface TaskPayload {
  description: string;
  codeContext?: string;
  agentType?: AgentType;
}

export interface LaneDecision {
  lane: Lane;
  model: string;
  systemPrompt: string;
  requiresApproval: boolean;
  inputTokens: number;
  fableShare: number;
  capHeadroom: number; // 0–1 of the cap still unused
  reason: string;
}

export function routeTask(payload: TaskPayload, snapshot: SpendSnapshot): LaneDecision {
  const agentType = payload.agentType ?? 'generic';
  const text = `${payload.description}\n${payload.codeContext ?? ''}`;
  const inputTokens = estimateTokens(text);
  const fableShare = modelShare(snapshot, MODELS.FABLE);
  const capHeadroom = Math.max(0, 1 - fableShare / FABLE_SHARE_CAP);
  const nearCap = fableShare >= FABLE_SHARE_CAP * NEAR_CAP_RATIO;

  const decide = (lane: Lane, requiresApproval: boolean, reason: string): LaneDecision => ({
    lane,
    model: LANE_MODEL[lane],
    systemPrompt: buildSystemPrompt(lane, agentType),
    requiresApproval,
    inputTokens,
    fableShare,
    capHeadroom,
    reason,
  });

  // 1. Fast validations always take the cheap lane, regardless of budget.
  if (FAST_VALIDATION.test(payload.description)) {
    return decide('SEAT', false, 'fast validation/cleanup — speed lane');
  }

  // 2. Near the Fable cap, everything non-trivial routes down to SEAT.
  if (nearCap) {
    return decide(
      'SEAT',
      false,
      `fable share ${(fableShare * 100).toFixed(1)}% ≥ ${(FABLE_SHARE_CAP * NEAR_CAP_RATIO * 100).toFixed(0)}% of cap — forced speed lane`
    );
  }

  const complexity = classifyComplexity(text);

  // 3. High-ambiguity / creative / messy-input work → Opus.
  if (HIGH_AMBIGUITY.test(payload.description)) {
    return decide('DOWN', false, 'high-ambiguity/creative payload — contextual lane');
  }

  if (complexity === 'high-stakes') {
    // 4. High-stakes but small → not worth Fable.
    if (inputTokens < MIN_FABLE_PAYLOAD_TOKENS) {
      return decide('DOWN', false, `high-stakes, ${inputTokens}tok < ${MIN_FABLE_PAYLOAD_TOKENS} — contextual lane`);
    }
    // 5. Massive structural planning → Fable, staged for human approval.
    return decide(
      'UP',
      true,
      `massive structural payload (${inputTokens}tok, headroom ${(capHeadroom * 100).toFixed(0)}%) — staged for approval`
    );
  }

  // 6. Routine default.
  return decide('SEAT', false, 'routine payload — speed lane');
}

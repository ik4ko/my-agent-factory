import type { ActiveBrainId } from '@/lib/agents/brain-matrix';
import type { ChatHistoryScope } from './history';

/**
 * Personal-mentor chat lanes — the bridge between the BRAIN_MATRIX mentor
 * definitions and the AgentChat picker.
 *
 * Each lane binds one private brain-matrix mentor (its own model,
 * temperature, and MENTOR_CORE system prompt, dispatched via dispatchAgent)
 * to one DEDICATED history scope. The scope binding is the isolation
 * guarantee: switching lanes swaps both the persona and the persisted
 * conversation atomically, so no mentor ever sees another mentor's history.
 *
 * Kept as a plain data module (no React) so the mapping is unit-testable —
 * see __tests__/mentor-lanes.test.ts, which asserts scope uniqueness and
 * that every lane points at a private, dispatchable brain.
 */
export interface MentorLane {
  agentId: ActiveBrainId;
  scope: ChatHistoryScope;
  label: string;
  description: string;
}

export const MENTOR_LANES = {
  MENTOR_BUSINESS: {
    agentId: 'MENTOR_BUSINESS',
    scope: 'mentor_business',
    label: 'BUSINESS · wealth mentor',
    description: 'Wealth-building strategy: leverage, cash flow, concrete next moves.',
  },
  MENTOR_MONEY: {
    agentId: 'MENTOR_MONEY',
    scope: 'mentor_money',
    label: 'MONEY · tradeoffs mentor',
    description: 'Financial tradeoffs laid out plainly — not a licensed advisor.',
  },
  MENTOR_LIFE: {
    agentId: 'MENTOR_LIFE',
    scope: 'mentor_life',
    label: 'LIFE · accountability mentor',
    description: 'Day-to-day commitments, routines, and honest check-ins.',
  },
  MENTOR_HEALTH: {
    agentId: 'MENTOR_HEALTH',
    scope: 'mentor_health',
    label: 'HEALTH · fitness mentor',
    description: 'Training, nutrition, sleep, and grounded wellbeing — never harm.',
  },
} as const satisfies Record<string, MentorLane>;

export type MentorLaneId = keyof typeof MENTOR_LANES;
export const MENTOR_LANE_IDS = Object.keys(MENTOR_LANES) as [MentorLaneId, ...MentorLaneId[]];

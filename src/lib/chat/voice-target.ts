import type { ChatHistoryScope } from './history';
import { MENTOR_LANES } from './mentor-lanes';
import type { PersonalLane } from './lane-store';

export type VoicePersona = 'architect' | 'trading' | 'coding';

/** Where an ambient voice command goes: the CEO converse route (persona on
 *  the CLAUDE brain) or a brain-matrix mentor via dispatchAgent. */
export type VoiceTarget =
  | { kind: 'converse'; scope: ChatHistoryScope; persona: VoicePersona; label: string }
  | { kind: 'mentor'; agentId: keyof typeof MENTOR_LANES; scope: ChatHistoryScope; label: string };

/**
 * Pure route→target resolution, unit-tested in __tests__/voice-target.test.ts.
 * In the Personal Room the target follows the PICKER's selected lane, so
 * speaking and typing always reach the same mentor and the same history
 * scope — voice must never silently talk to a different brain than the UI
 * shows selected.
 */
export function resolveVoiceTarget(pathname: string, personalLane: PersonalLane): VoiceTarget {
  if (pathname.includes('/rooms/trading')) return { kind: 'converse', scope: 'trading', persona: 'trading', label: 'Trading' };
  if (pathname.includes('/rooms/coding')) return { kind: 'converse', scope: 'coding', persona: 'coding', label: 'Coding' };
  if (pathname.includes('/dashboard/personal')) {
    if (personalLane === 'CLAUDE') {
      // Typed CLAUDE lane in the Personal Room uses the architect persona on
      // the shared room scope — voice mirrors it exactly.
      return { kind: 'converse', scope: 'personal', persona: 'architect', label: 'Personal · CLAUDE' };
    }
    const lane = MENTOR_LANES[personalLane];
    return { kind: 'mentor', agentId: lane.agentId, scope: lane.scope, label: lane.label };
  }
  return { kind: 'converse', scope: 'hub', persona: 'architect', label: 'Hub' };
}

import { ACTIVE_BRAIN_IDS, BRAIN_MATRIX } from '@/lib/agents/brain-matrix';
import { MENTOR_LANES, MENTOR_LANE_IDS } from '../mentor-lanes';

describe('mentor lanes — isolation and dispatchability invariants', () => {
  it('every mentor lane has a DEDICATED history scope (no sharing, no room scopes)', () => {
    const scopes = MENTOR_LANE_IDS.map((id) => MENTOR_LANES[id].scope);
    // Distinct from each other — a duplicate here is exactly the silent
    // cross-mentor history leak this design exists to prevent.
    expect(new Set(scopes).size).toBe(scopes.length);
    // And never a shared room scope.
    const roomScopes = ['hub', 'trading', 'coding', 'personal', 'ceo', 'matrix'];
    for (const scope of scopes) {
      expect(roomScopes).not.toContain(scope);
      expect(scope).toMatch(/^mentor_/);
    }
  });

  it('every mentor lane points at a dispatchable brain (in ACTIVE_BRAIN_IDS)', () => {
    for (const id of MENTOR_LANE_IDS) {
      expect(ACTIVE_BRAIN_IDS).toContain(MENTOR_LANES[id].agentId);
    }
  });

  it('every mentor brain is private (no cross-room event mirroring)', () => {
    for (const id of MENTOR_LANE_IDS) {
      const def = BRAIN_MATRIX[MENTOR_LANES[id].agentId];
      expect(def.private).toBe(true);
    }
  });

  it('mentor lanes cover all four brain-matrix mentors with matching ids', () => {
    expect(MENTOR_LANE_IDS.sort()).toEqual(['MENTOR_BUSINESS', 'MENTOR_HEALTH', 'MENTOR_LIFE', 'MENTOR_MONEY']);
    for (const id of MENTOR_LANE_IDS) {
      expect(MENTOR_LANES[id].agentId).toBe(id);
    }
  });
});

import { MENTOR_LANES, type MentorLaneId } from '../mentor-lanes';
import { resolveVoiceTarget } from '../voice-target';

describe('resolveVoiceTarget', () => {
  it.each(Object.keys(MENTOR_LANES) as MentorLaneId[])(
    'routes Personal Room voice through the selected %s mentor lane',
    (laneId) => {
      expect(resolveVoiceTarget('/dashboard/personal', laneId)).toEqual({
        kind: 'mentor',
        agentId: MENTOR_LANES[laneId].agentId,
        scope: MENTOR_LANES[laneId].scope,
        label: MENTOR_LANES[laneId].label,
      });
    },
  );

  it('keeps the Personal CLAUDE lane on the legacy personal scope', () => {
    expect(resolveVoiceTarget('/dashboard/personal', 'CLAUDE')).toMatchObject({
      kind: 'converse',
      scope: 'personal',
      persona: 'architect',
    });
  });
});

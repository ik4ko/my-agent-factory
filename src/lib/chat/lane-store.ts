import { create } from 'zustand';
import type { MentorLaneId } from './mentor-lanes';

/** Lanes selectable in the Personal Room picker. */
export type PersonalLane = MentorLaneId | 'CLAUDE';

interface PersonalLaneState {
  /** The Personal Room's currently selected chat lane. AgentChat publishes
   *  this on every lane change so ambient voice (Nova) talks to the SAME
   *  mentor + history scope as typed chat — never a diverging persona. */
  personalLane: PersonalLane;
  setPersonalLane: (lane: PersonalLane) => void;
}

export const usePersonalLaneStore = create<PersonalLaneState>((set) => ({
  // Matches the Personal Room's defaultLane so voice and the picker agree
  // before the first manual selection.
  personalLane: 'MENTOR_BUSINESS',
  setPersonalLane: (lane) => set({ personalLane: lane }),
}));

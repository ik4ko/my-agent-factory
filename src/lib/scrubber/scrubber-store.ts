'use client';

import { create } from 'zustand';

// Time-travel scrubber. Deliberately decoupled from the live query cache so
// scrubbing never participates in the high-frequency streaming render path.
interface ScrubberStore {
  active: boolean;
  /** Epoch ms of the snapshot the operator is viewing, or null when live. */
  snapshotAt: number | null;
  setActive: (active: boolean) => void;
  setSnapshot: (t: number | null) => void;
}

export const useScrubberStore = create<ScrubberStore>((set) => ({
  active: false,
  snapshotAt: null,
  setActive: (active) => set({ active, snapshotAt: active ? null : null }),
  setSnapshot: (snapshotAt) => set({ snapshotAt }),
}));

/** Returns the active snapshot timestamp (ms) or null when viewing live data. */
export function useSnapshotAt(): number | null {
  return useScrubberStore((s) => (s.active ? s.snapshotAt : null));
}

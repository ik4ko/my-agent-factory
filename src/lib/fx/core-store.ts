/**
 * useCoreFxStore — state bridge between dashboard UI producers and the
 * CinematicCore 3D engine.
 *
 * Producers:
 *  - agent-fleet.tsx  → setFocusTarget(agentId, cardRect) on hover
 *  - task-input.tsx   → setIsListening(true|false) on voice arm/disarm
 *
 * Consumer:
 *  - dashboard-client.tsx → atomic selectors feeding <CinematicCore />
 *
 * Coordinate contract: `focusTarget` is the exact center of the agent card
 * in viewport CSS pixels. The 3D engine converts px → NDC → world by
 * unprojecting against the LIVE canvas rect every frame (see
 * cinematic-core.tsx `focusWorldPoint`). NDC is deliberately not cached
 * here: a precomputed NDC snapshot goes stale the moment the user scrolls,
 * resizes, or drags a panel handle, which would bend the beam toward a
 * position the card no longer occupies.
 */

import { create } from 'zustand';

export interface CoreFocusPoint {
  /** Viewport-space x of the focused card's center, CSS pixels. */
  x: number;
  /** Viewport-space y of the focused card's center, CSS pixels. */
  y: number;
}

interface CoreFxState {
  /** Voice capture is armed and actively listening. */
  isListening: boolean;
  /** Agent card currently under the pointer, if any. */
  focusedAgentId: string | null;
  /** Center point of the focused card; null = beam idles at the core. */
  focusTarget: CoreFocusPoint | null;

  setIsListening: (status: boolean) => void;
  /**
   * Atomically set (or clear) the focused agent and its beam anchor.
   * Passing `(null, null)` snaps the beam back to idle.
   */
  setFocusTarget: (id: string | null, rect: DOMRect | null) => void;
}

export const useCoreFxStore = create<CoreFxState>()((set) => ({
  isListening: false,
  focusedAgentId: null,
  focusTarget: null,

  setIsListening: (status) => set({ isListening: status }),

  setFocusTarget: (id, rect) => {
    if (id === null || rect === null) {
      set({ focusedAgentId: null, focusTarget: null });
      return;
    }
    set({
      focusedAgentId: id,
      focusTarget: {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      },
    });
  },
}));

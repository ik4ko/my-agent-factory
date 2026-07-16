/**
 * useCoreFxStore — state bridge between dashboard UI producers and the
 * Brain Hub WebGL scene (SpatialWorkspace — the app's single Three.js
 * surface).
 *
 * Producers:
 *  - GlobalVoiceControl / AgentChat → setIsListening(true|false) on voice capture
 *
 * Consumers (frame-loop getState() reads only — no React subscriptions, so
 * hover/voice churn never re-renders the scene tree):
 *  - SpatialWorkspace BusCore   → `isListening` breathes the central bus
 *
 * `focusTarget` (card center, viewport CSS px) is retained for API
 * stability with the producers; the Brain Hub keys off `focusedAgentId`
 * alone.
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

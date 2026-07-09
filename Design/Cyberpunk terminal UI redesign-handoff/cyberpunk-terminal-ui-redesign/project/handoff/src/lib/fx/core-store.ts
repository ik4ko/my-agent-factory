'use client';

/**
 * Shared FX store — routes `isListening` (TaskInput) and `focusTarget`
 * (AgentFleet card hover) into CinematicCore WITHOUT re-rendering the
 * dashboard tree. Only the CoreLayer subscribes; producers call
 * useCoreFxStore.getState().set*() imperatively, so a card hover never
 * triggers layout work outside the canvas.
 *
 * Also owns the operator Tweaks (particle opacity / density / scanlines),
 * persisted to localStorage.
 */

import { create } from 'zustand';

export interface CoreFocusTarget {
  x: number;
  y: number;
  id?: string;
}

interface FxTweaks {
  opacity: number;      // base particle opacity (uniform uOpacity)
  densityScale: number; // multiplier on the particle budget (applied at init)
  scanlines: boolean;
}

interface CoreFxState extends FxTweaks {
  isListening: boolean;
  focusTarget: CoreFocusTarget | null;
  tweaksOpen: boolean;
  setListening: (v: boolean) => void;
  setFocusTarget: (t: CoreFocusTarget | null) => void;
  setTweaksOpen: (v: boolean) => void;
  setTweaks: (t: Partial<FxTweaks>) => void;
}

const STORAGE_KEY = 'maf-fx-tweaks';

const DEFAULTS: FxTweaks = {
  opacity: 0.12,
  densityScale: 1,
  scanlines: true,
};

function loadTweaks(): FxTweaks {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<FxTweaks>;
    return {
      opacity: Math.min(0.4, Math.max(0.02, Number(parsed.opacity) || DEFAULTS.opacity)),
      densityScale: Math.min(1.5, Math.max(0.25, Number(parsed.densityScale) || DEFAULTS.densityScale)),
      scanlines: parsed.scanlines ?? DEFAULTS.scanlines,
    };
  } catch {
    return DEFAULTS;
  }
}

export const useCoreFxStore = create<CoreFxState>((set, get) => ({
  ...loadTweaks(),
  isListening: false,
  focusTarget: null,
  tweaksOpen: false,
  setListening: (v) => set({ isListening: v }),
  setFocusTarget: (t) => set({ focusTarget: t }),
  setTweaksOpen: (v) => set({ tweaksOpen: v }),
  setTweaks: (t) => {
    set(t);
    if (typeof window !== 'undefined') {
      const { opacity, densityScale, scanlines } = { ...get(), ...t };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ opacity, densityScale, scanlines }));
      } catch {
        /* quota / private mode — non-fatal */
      }
    }
  },
}));

'use client';

import { create } from 'zustand';

/**
 * Global "still mode" toggle for decorative micro-interactions — grain,
 * weight tweens, digit rolls, and the WebAudio confirmation tones are all
 * gated behind this (HANDOFF_SPEC §4/§5). Defaults to the user's OS
 * prefers-reduced-motion preference; the ⌘K palette can flip it for a demo.
 */
interface MotionStore {
  motion: boolean;
  setMotion: (v: boolean) => void;
  toggle: () => void;
}

function initialMotion(): boolean {
  if (typeof window === 'undefined') return true;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export const useMotionStore = create<MotionStore>((set, get) => ({
  motion: initialMotion(),
  setMotion: (v) => set({ motion: v }),
  toggle: () => set({ motion: !get().motion }),
}));

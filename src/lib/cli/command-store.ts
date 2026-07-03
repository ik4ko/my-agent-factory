'use client';

import { create } from 'zustand';

export type OutputLevel = 'info' | 'success' | 'error' | 'system';

export interface ConsoleLine {
  id: string;
  text: string;
  level: OutputLevel;
  at: number;
}

const MAX_HISTORY = 50;
const MAX_OUTPUT = 200;

interface CommandStore {
  open: boolean;
  history: string[];        // newest last
  outputs: ConsoleLine[];
  setOpen: (open: boolean) => void;
  toggle: () => void;
  pushHistory: (cmd: string) => void;
  print: (text: string, level?: OutputLevel) => void;
  clearOutput: () => void;
}

export const useCommandStore = create<CommandStore>((set) => ({
  open: false,
  history: [],
  outputs: [],
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  pushHistory: (cmd) =>
    set((s) => ({ history: [...s.history, cmd].slice(-MAX_HISTORY) })),
  print: (text, level = 'info') =>
    set((s) => ({
      outputs: [
        ...s.outputs,
        { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text, level, at: Date.now() },
      ].slice(-MAX_OUTPUT),
    })),
  clearOutput: () => set({ outputs: [] }),
}));

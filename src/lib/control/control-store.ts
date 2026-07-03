'use client';

import { create } from 'zustand';

// Shared state for the guarded Emergency Stop confirm flow, so both the
// header button and the `/halt` console command open the same modal.
interface ControlStore {
  emergencyOpen: boolean;
  openEmergency: () => void;
  closeEmergency: () => void;
}

export const useControlStore = create<ControlStore>((set) => ({
  emergencyOpen: false,
  openEmergency: () => set({ emergencyOpen: true }),
  closeEmergency: () => set({ emergencyOpen: false }),
}));

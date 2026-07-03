'use client';

import { create } from 'zustand';

export type ChannelStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed';
export type OverallStatus = 'connected' | 'connecting' | 'reconnecting' | 'offline';

interface ConnectionStore {
  /** Per-channel status, keyed by channel name. */
  channels: Record<string, ChannelStatus>;
  /** Browser network reachability (navigator.onLine). */
  online: boolean;
  setChannelStatus: (name: string, status: ChannelStatus) => void;
  clearChannel: (name: string) => void;
  setOnline: (online: boolean) => void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  channels: {},
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  setChannelStatus: (name, status) =>
    set((s) =>
      s.channels[name] === status ? s : { channels: { ...s.channels, [name]: status } }
    ),
  clearChannel: (name) =>
    set((s) => {
      if (!(name in s.channels)) return s;
      const next = { ...s.channels };
      delete next[name];
      return { channels: next };
    }),
  setOnline: (online) => set((s) => (s.online === online ? s : { online })),
}));

/** Collapse per-channel statuses + network state into a single UI signal. */
export function selectOverallStatus(s: ConnectionStore): OverallStatus {
  if (!s.online) return 'offline';
  const statuses = Object.values(s.channels);
  if (statuses.length === 0) return 'connecting';
  if (statuses.some((st) => st === 'reconnecting' || st === 'closed')) return 'reconnecting';
  if (statuses.some((st) => st === 'connecting')) return 'connecting';
  return 'connected';
}

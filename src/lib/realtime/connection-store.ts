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
  // HYDRATION DETERMINISM: always initialize `true` on BOTH server and
  // client. Reading navigator.onLine at module load made the client's first
  // render diverge from server HTML whenever the browser reported offline
  // at boot (VPN blips, captive portals, Chrome's unreliable flag) — a
  // fatal hydration mismatch at the ConnectionBanner. The REAL reachability
  // arrives one effect-tick later via ConnectionIndicator's mount sync +
  // online/offline listeners (setOnline below).
  online: true,
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

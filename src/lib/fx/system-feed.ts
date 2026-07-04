'use client';

/**
 * useSystemFeed — client-side diagnostics feed for the Live Terminal.
 *
 * These entries are UI lifecycle telemetry (command dispatch, voice arm,
 * agent state transitions observed in the browser). They deliberately live
 * OUTSIDE the Supabase `logs` cache: they are never persisted, never survive
 * a refresh, and can never be wiped by a query refetch. The terminal merges
 * them with DB logs by timestamp at render time.
 *
 * Producers:
 *  - task-input.tsx    → DISPATCH / NETWORK / SYSTEM lines on command lifecycle
 *  - task-input.tsx    → VOICE lines on mic arm/disarm
 *  - live-terminal.tsx → SYSTEM lines on agent status transitions
 *  - live-terminal.tsx → COGNITION lines forwarding live LLM stream deltas
 *  - live-terminal.tsx → STRATEGY lines on staged_orders realtime INSERTs
 */

import { create } from 'zustand';

export type FeedChannel =
  | 'SYSTEM'
  | 'NETWORK'
  | 'DISPATCH'
  | 'VOICE'
  | 'COGNITION'
  | 'STRATEGY'
  | 'CRITICAL';

export interface SystemFeedEntry {
  id: string;
  /** ISO 8601, comparable with Supabase `logs.timestamp`. */
  timestamp: string;
  channel: FeedChannel;
  message: string;
}

/** Ring-buffer cap — COGNITION streams are chatty, so the buffer is sized to
 *  hold a full multi-stage pipeline run without evicting lifecycle lines. */
const CAP = 120;

let seq = 0;

interface SystemFeedState {
  entries: SystemFeedEntry[];
  push: (channel: FeedChannel, message: string) => void;
}

export const useSystemFeed = create<SystemFeedState>()((set) => ({
  entries: [],
  push: (channel, message) =>
    set((state) => ({
      entries: [
        ...state.entries,
        {
          id: `sysfeed-${Date.now()}-${seq++}`,
          timestamp: new Date().toISOString(),
          channel,
          message,
        },
      ].slice(-CAP),
    })),
}));

/** Imperative producer for non-hook call sites (async handlers, callbacks). */
export function pushSystemFeed(channel: FeedChannel, message: string): void {
  useSystemFeed.getState().push(channel, message);
}

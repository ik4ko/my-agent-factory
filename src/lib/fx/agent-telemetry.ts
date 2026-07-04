'use client';

/**
 * useAgentTelemetryStore — session-scoped compute telemetry per agent.
 *
 * Feeds the fleet cards' BRAIN / LAT / OPS strip. Data is derived
 * client-side from the shared realtime caches (agents + tasks) by a single
 * producer in agent-fleet.tsx; each memoized AgentCard subscribes to ONLY
 * its own slice, so a pipeline stage finishing updates exactly one card —
 * never the whole fleet, and never on the worker's 1.5s streaming flushes.
 *
 *  - model:         last model this agent executed with (tasks.model)
 *  - lastLatencyMs: measured busy→idle round-trip of the last step; falls
 *                   back to updated_at − created_at of the latest completed
 *                   task when the session started after the run
 *  - opsCompleted:  tasks/pipeline steps completed during THIS session
 */

import { create } from 'zustand';

export interface AgentTelemetrySlice {
  model: string | null;
  lastLatencyMs: number | null;
  opsCompleted: number;
}

export const EMPTY_TELEMETRY: AgentTelemetrySlice = {
  model: null,
  lastLatencyMs: null,
  opsCompleted: 0,
};

function patch(
  byAgent: Record<string, AgentTelemetrySlice>,
  id: string,
  changes: Partial<AgentTelemetrySlice>,
): Record<string, AgentTelemetrySlice> {
  // Replaces only the target agent's slice object — untouched agents keep
  // their reference, so their subscribed cards do not re-render.
  return { ...byAgent, [id]: { ...(byAgent[id] ?? EMPTY_TELEMETRY), ...changes } };
}

interface AgentTelemetryState {
  byAgent: Record<string, AgentTelemetrySlice>;
  /** Busy-transition timestamps (epoch ms) for in-flight latency measurement. */
  busySince: Record<string, number>;

  markBusy: (agentId: string, at: number) => void;
  /** Closes an open busy window and records the measured round-trip. */
  markIdle: (agentId: string, at: number) => void;
  /** Increments the session op counter and refreshes the model badge. */
  recordCompletion: (agentId: string, model: string | null) => void;
  /** One-time baseline from pre-session history; never overwrites live data. */
  seed: (agentId: string, model: string | null, latencyMs: number | null) => void;
}

export const useAgentTelemetryStore = create<AgentTelemetryState>()((set) => ({
  byAgent: {},
  busySince: {},

  markBusy: (agentId, at) =>
    set((state) => ({ busySince: { ...state.busySince, [agentId]: at } })),

  markIdle: (agentId, at) =>
    set((state) => {
      const since = state.busySince[agentId];
      if (since === undefined) return state; // busy start not observed this session
      const busySince = { ...state.busySince };
      delete busySince[agentId];
      return {
        busySince,
        byAgent: patch(state.byAgent, agentId, { lastLatencyMs: Math.max(0, at - since) }),
      };
    }),

  recordCompletion: (agentId, model) =>
    set((state) => {
      const current = state.byAgent[agentId] ?? EMPTY_TELEMETRY;
      return {
        byAgent: patch(state.byAgent, agentId, {
          opsCompleted: current.opsCompleted + 1,
          model: model ?? current.model,
        }),
      };
    }),

  seed: (agentId, model, latencyMs) =>
    set((state) => {
      const current = state.byAgent[agentId];
      // Session data always wins over historical baseline.
      if (current && (current.model !== null || current.lastLatencyMs !== null || current.opsCompleted > 0)) {
        return state;
      }
      return { byAgent: patch(state.byAgent, agentId, { model, lastLatencyMs: latencyMs }) };
    }),
}));

import { create } from 'zustand';

export type SpatialRoom = 'trading' | 'coding' | 'analytics';

interface Pulse {
  /** performance.now() of the last event on this room's mesh */
  at: number;
  /** magnitude of the last pulse (0..1), stacked when events cluster */
  mag: number;
  /** running total, drives a small "live event count" HUD readout */
  count: number;
}

interface SpatialPulseState {
  pulses: Record<SpatialRoom, Pulse>;
  pulse: (room: SpatialRoom, mag?: number) => void;
}

const EMPTY = (): Pulse => ({ at: 0, mag: 0, count: 0 });

/**
 * Cross-render event bus for the 3D scene. A realtime log/metric INSERT calls
 * pulse(room); the R3F mesh reads the store via getState() inside useFrame
 * (never subscribes — no React re-render per frame) and decays the emissive
 * flash itself. This is what makes the geometry physically react to the
 * Supabase data bus.
 */
export const useSpatialPulse = create<SpatialPulseState>((set) => ({
  pulses: { trading: EMPTY(), coding: EMPTY(), analytics: EMPTY() },
  pulse: (room, mag = 1) =>
    set((s) => ({
      pulses: {
        ...s.pulses,
        [room]: {
          at: (typeof performance !== 'undefined' ? performance.now() : Date.now()),
          mag: Math.min(1.6, s.pulses[room].mag * 0.4 + mag),
          count: s.pulses[room].count + 1,
        },
      },
    })),
}));

/** Classify a persisted log line to the mesh it should light up. Trading risk/
 *  order/regime events (the HERMES model path) flash the Trading monitor;
 *  Codex/sandbox/pipeline events flash Coding; token/usage everything else
 *  flashes Analytics. */
export function classifyLogRoom(message: string): SpatialRoom {
  const m = message.toLowerCase();
  if (/\[(risk|order|regime|control|loop)\]|kill switch|auto-halt|staged|thesis|trade/.test(m)) return 'trading';
  if (/codex|\[(pipeline|sandbox|tool-runner)\]|patch|dispatch completed/.test(m)) return 'coding';
  return 'analytics';
}

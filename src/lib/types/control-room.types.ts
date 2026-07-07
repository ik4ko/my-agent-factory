// Control Room view-model types. These sit ABOVE the raw DB row types in
// database.types.ts: they encode presentation state the schema can't (field
// readiness, grouping, severity), so components never render a bare "—"
// without a machine-readable reason behind it.
import type { Agent, LogLevel, Task } from './database.types';

/** A data-driven display field is never just "value or dash" — it is always
 *  in exactly one of these states, and empty/error carry an operator-readable
 *  reason surfaced as tooltip + aria-label. */
export type FieldState<T> =
  | { status: 'ready'; value: T }
  | { status: 'loading' }
  | { status: 'empty'; reason: string }
  | { status: 'error'; reason: string };

/** Per-agent compute telemetry derived from completed tasks + live session
 *  transitions (never invented): brain = model that ran the agent's most
 *  recent completed task; latency = busy→idle span or task created→updated. */
export interface AgentTelemetryView {
  brain: FieldState<string>;
  latencyMs: FieldState<number>;
  opsCompleted: number;
}

/** Fleet split: agents with any signs of life vs dormant seed rows. A seed is
 *  inactive when it has no heartbeat within the window, no task history, no
 *  current assignment, and is not busy. */
export interface FleetPartition {
  active: Agent[];
  inactive: Agent[];
}

/** One "matrix run": N tasks sharing the same objective string, fanned out
 *  across agents, rendered as a single expandable card with a rollup. */
export interface TaskRunGroup {
  objective: string;
  tasks: Task[];
  rollup: {
    total: number;
    completed: number;
    running: number;
    failed: number;
    pending: number;
    cancelled: number;
  };
}

/** Terminal severity used for filtering. DB `success` renders as OK but
 *  filters with INFO; heartbeat proof-of-life lines are reclassified DEBUG
 *  regardless of their stored level so they never bury real events. */
export type TerminalSeverity = 'error' | 'warn' | 'info' | 'debug';

export interface LogEntryView {
  key: string;
  ts: number;
  severity: TerminalSeverity;
  /** original DB level (or feed channel) for rendering the tag/color */
  levelTag: string;
  isHeartbeat: boolean;
}

/** A metric in the top strip: no number renders without a label, unit, and a
 *  tooltip that explains what it measures (and its threshold, if any). */
export interface MetricDef {
  id: string;
  label: string;
  unit: string;
  tooltip: string;
}

/** Memory record opened in the inspector drawer. */
export interface MemoryRecordView {
  id: string;
  memKey: string;
  value: unknown;
  updatedAt: string | null;
  source: string | null;
  tags: string[];
}

export const HEARTBEAT_PATTERN = /heartbeat/i;

/** Map a DB log level to a filter severity ('success' counts as info). */
export function levelToSeverity(level: LogLevel): TerminalSeverity {
  if (level === 'success') return 'info';
  return level;
}

export const INACTIVE_AFTER_MS = 7 * 24 * 3600_000;

/** Seed/unused detector shared by the fleet panel AND the metrics strip so
 *  the "idle agents" figure can never disagree with the deduplicated fleet:
 *  dormant = not busy, nothing assigned, no task history, and no heartbeat
 *  within the window (or never). */
export function partitionFleet(agents: Agent[], hasHistory: (id: string) => boolean): FleetPartition {
  const active: Agent[] = [];
  const inactive: Agent[] = [];
  const now = Date.now();
  for (const a of agents) {
    const hb = a.last_heartbeat ? Date.parse(a.last_heartbeat) : null;
    const heartbeatFresh = hb !== null && Number.isFinite(hb) && now - hb < INACTIVE_AFTER_MS;
    const dormant = a.status !== 'busy' && !a.current_task_id && !hasHistory(a.id) && !heartbeatFresh;
    (dormant ? inactive : active).push(a);
  }
  return { active, inactive };
}

/** Matrix runs embed a routing tag in the description
 *  ("[MATRIX:DEBATE:SCOUT] analyze …"); the shared objective is what remains
 *  after stripping it. Returns the tag (if any) for sub-row labeling. */
export function splitObjective(description: string): { objective: string; tag: string | null } {
  const match = /^\[([^\]]+)\]\s*([\s\S]*)$/.exec(description.trim());
  if (match && match[2].trim().length > 0) {
    return { objective: match[2].trim(), tag: match[1].trim() };
  }
  return { objective: description.trim(), tag: null };
}

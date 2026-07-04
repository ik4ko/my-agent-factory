import { z } from 'zod';
import type { AgentType } from '@/lib/types/database.types';
import type { MarketContext } from '@/lib/market/fetcher';

/**
 * Multi-agent pipeline domain types.
 *
 * A pipeline is a sequential chain of tasks sharing a `pipeline` context
 * object stored in `tasks.result.pipeline` (JSONB — additive, zero schema
 * migration required; see engine.ts header for the column-upgrade path).
 */

export const PIPELINE_ROLES = ['RESEARCH', 'ANALYSIS', 'EXECUTION'] as const;
export type PipelineRole = (typeof PIPELINE_ROLES)[number];

/** Context persisted on every step task under result.pipeline. */
export const PipelineContextSchema = z.object({
  /** Groups all step tasks of one run. */
  id: z.string().uuid(),
  playbook: z.string().min(1),
  /** 0-based index into the playbook's steps. */
  step: z.number().int().min(0),
  role: z.enum(PIPELINE_ROLES),
  /** The operator's original objective, verbatim, for every step. */
  objective: z.string().min(1),
  /** Sandbox mode: no model calls, no external APIs — full trace only. */
  simulate: z.boolean(),
  /** Provenance: who initiated the run. The autonomous kill switch counts
   *  'autonomous' step-0 tasks per calendar day. Optional for back-compat
   *  with pre-Phase-6 rows; absent means 'manual'. */
  trigger: z.enum(['manual', 'autonomous']).optional(),
});
export type PipelineContext = z.infer<typeof PipelineContextSchema>;

export interface PlaybookStep {
  role: PipelineRole;
  /** Routed through findIdleAgent (name convention: generic→Hermes, coder→Codex). */
  agentType: AgentType;
  /** Preferred named agent (e.g. a dedicated 'Executor' row, if seeded). */
  nameHint: string;
  /** Short human description shown as the task description in the feed. */
  describe: (objective: string) => string;
  /** System prompt for the live worker. `priorOutput` is the previous step's
   *  full text; `market` is live telemetry (RESEARCH stage only), injected
   *  server-side so neither the operator nor the model can override it. */
  buildSystemPrompt: (
    objective: string,
    priorOutput: string | null,
    market?: MarketContext | null,
  ) => string;
  /** Deterministic output for sandbox simulation runs (no model, no broker). */
  simulateOutput: (objective: string, priorOutput: string | null) => string;
}

export interface PipelinePlaybook {
  name: string;
  steps: readonly PlaybookStep[];
}

/** Response contract for POST /api/pipeline/run (shared with the dashboard client). */
export interface PipelineRunResponse {
  pipelineId: string;
  playbook: string;
  simulate: boolean;
  firstStage: {
    role: PipelineRole;
    taskId: string;
    agent: string;
  };
}

/** Everything needed to execute one step (returned by start/advance). */
export interface StepDispatch {
  context: PipelineContext;
  taskId: string;
  /** null = virtual agent (e.g. Executor not yet seeded); step still runs. */
  agentId: string | null;
  agentName: string;
  description: string;
  priorOutput: string | null;
}

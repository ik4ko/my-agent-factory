// Token ledger — reads/writes the `metrics` table (realtime-replicated).
// Every model transition (SEAT/UP/DOWN), usage report, and halt is a row.
import { getAdminClient } from '@/lib/supabase/admin';
import type { ModelEvent } from '@/lib/types/database.types';

export interface ModelEventInput {
  model: string;
  event: ModelEvent;
  taskId?: string | null;
  agentId?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  detail?: string;
}

/** Fire-and-forget telemetry write. Telemetry must never crash the loop. */
export async function recordModelEvent(e: ModelEventInput): Promise<void> {
  try {
    const db = getAdminClient();
    await db.from('metrics').insert({
      model: e.model,
      event: e.event,
      task_id: e.taskId ?? null,
      agent_id: e.agentId ?? null,
      input_tokens: e.inputTokens ?? 0,
      output_tokens: e.outputTokens ?? 0,
      detail: e.detail ?? null,
    });
  } catch {
    /* never throw from telemetry */
  }
}

export interface SpendSnapshot {
  totalTokens: number;
  byModel: Record<string, number>;
  windowHours: number;
}

/** Aggregate ecosystem token spend over the trailing window (default 24h). */
export async function getSpendSnapshot(windowHours = 24): Promise<SpendSnapshot> {
  const db = getAdminClient();
  const since = new Date(Date.now() - windowHours * 3_600_000).toISOString();
  const { data, error } = await db
    .from('metrics')
    .select('model, input_tokens, output_tokens')
    .gte('created_at', since)
    .limit(10_000);
  if (error) throw new Error(`[ledger] spend query failed: ${error.message}`);

  const byModel: Record<string, number> = {};
  let totalTokens = 0;
  for (const row of data ?? []) {
    const spend = (row.input_tokens ?? 0) + (row.output_tokens ?? 0);
    byModel[row.model] = (byModel[row.model] ?? 0) + spend;
    totalTokens += spend;
  }
  return { totalTokens, byModel, windowHours };
}

/** Share (0–1) of total spend attributed to `model` in the snapshot. */
export function modelShare(snapshot: SpendSnapshot, model: string): number {
  if (snapshot.totalTokens <= 0) return 0;
  return (snapshot.byModel[model] ?? 0) / snapshot.totalTokens;
}

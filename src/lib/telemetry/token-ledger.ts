// Token ledger — reads/writes the `metrics` table (realtime-replicated).
// Every model transition (SEAT/UP/DOWN), usage report, and halt is a row.
import { getAdminClient } from '@/lib/supabase/admin';
import type { ModelEvent } from '@/lib/types/database.types';
import { estimateMetricCostUsd } from '@/lib/telemetry/pricing';

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
    const { error } = await db.from('metrics').insert({
      model: e.model,
      event: e.event,
      task_id: e.taskId ?? null,
      agent_id: e.agentId ?? null,
      input_tokens: e.inputTokens ?? 0,
      output_tokens: e.outputTokens ?? 0,
      detail: e.detail ?? null,
    });
    if (error) {
      console.error('[token-ledger] metrics insert failed', {
        model: e.model,
        event: e.event,
        taskId: e.taskId ?? null,
        agentId: e.agentId ?? null,
        inputTokens: e.inputTokens ?? 0,
        outputTokens: e.outputTokens ?? 0,
        detail: e.detail ?? null,
        error: error.message,
      });
    }
  } catch (err) {
    console.error('[token-ledger] metrics insert threw', {
      model: e.model,
      event: e.event,
      taskId: e.taskId ?? null,
      agentId: e.agentId ?? null,
      inputTokens: e.inputTokens ?? 0,
      outputTokens: e.outputTokens ?? 0,
      detail: e.detail ?? null,
      err,
    });
  }
}

export interface SpendSnapshot {
  totalTokens: number;
  totalCostUsd?: number;
  byModel: Record<string, number>;
  byModelCostUsd?: Record<string, number>;
  windowHours: number;
}

async function getSpendSnapshotFrom(since: string, windowHours: number): Promise<SpendSnapshot> {
  const db = getAdminClient();
  const { data, error } = await db
    .from('metrics')
    .select('model, input_tokens, output_tokens')
    .gte('created_at', since)
    .limit(10_000);
  if (error) throw new Error(`[ledger] spend query failed: ${error.message}`);

  const byModel: Record<string, number> = {};
  const byModelCostUsd: Record<string, number> = {};
  let totalTokens = 0;
  let totalCostUsd = 0;
  for (const row of data ?? []) {
    const spend = (row.input_tokens ?? 0) + (row.output_tokens ?? 0);
    const costUsd = estimateMetricCostUsd(row);
    byModel[row.model] = (byModel[row.model] ?? 0) + spend;
    byModelCostUsd[row.model] = (byModelCostUsd[row.model] ?? 0) + costUsd;
    totalTokens += spend;
    totalCostUsd += costUsd;
  }
  return { totalTokens, totalCostUsd, byModel, byModelCostUsd, windowHours };
}

/** Aggregate ecosystem token spend over the trailing window (default 24h). */
export async function getSpendSnapshot(windowHours = 24): Promise<SpendSnapshot> {
  const since = new Date(Date.now() - windowHours * 3_600_000).toISOString();
  return getSpendSnapshotFrom(since, windowHours);
}

// 60s memo for the budget gates (registry, dispatcher, converse) — each
// dispatch was re-scanning up to 10k metric rows for the same month-start
// window. Caps are conservative and 60s of staleness cannot flip a gate by
// more than one minute of spend. Query FAILURES are never cached, so gates
// still fail closed on a live ledger error.
const SPEND_SNAPSHOT_TTL_MS = 60_000;
const spendSnapshotCache = new Map<string, { at: number; snapshot: SpendSnapshot }>();

/** Aggregate model spend since an explicit ISO timestamp, e.g. month start. */
export async function getSpendSnapshotSince(sinceIso: string): Promise<SpendSnapshot> {
  const cached = spendSnapshotCache.get(sinceIso);
  if (cached && Date.now() - cached.at < SPEND_SNAPSHOT_TTL_MS) return cached.snapshot;
  const windowHours = Math.max(0, (Date.now() - new Date(sinceIso).getTime()) / 3_600_000);
  const snapshot = await getSpendSnapshotFrom(sinceIso, windowHours);
  spendSnapshotCache.set(sinceIso, { at: Date.now(), snapshot });
  // A new month brings a new key; drop stale entries so the map stays tiny.
  for (const [key, entry] of spendSnapshotCache) {
    if (Date.now() - entry.at >= SPEND_SNAPSHOT_TTL_MS && key !== sinceIso) spendSnapshotCache.delete(key);
  }
  return snapshot;
}

/** Share (0–1) of total spend attributed to `model` in the snapshot. */
export function modelShare(snapshot: SpendSnapshot, model: string): number {
  if (snapshot.totalTokens <= 0) return 0;
  return (snapshot.byModel[model] ?? 0) / snapshot.totalTokens;
}

// Stale-lock reaper — self-healing for workers killed mid-stream (e.g. Vercel
// wall-clock limits). The streaming runner bumps tasks.updated_at AND the
// agent's last_heartbeat every ~1.5s in the same flush, so a `running` task
// whose updated_at is older than the threshold means its worker is dead —
// this also covers workers killed before their first heartbeat (updated_at is
// set at lock time) and tasks whose agent row is gone entirely.
import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { recordModelEvent } from '@/lib/telemetry/token-ledger';
import type { Task } from '@/lib/types/database.types';

export const STALE_LOCK_MINUTES = 3;
const MAX_REAP_BATCH = 20;

export interface ReapResult {
  scanned: number;
  recycled: number;
}

/**
 * Recycle tasks stuck `running` with no live worker: revert task → pending,
 * free the holding agent (idle, current_task_id = null), and emit a
 * single-line recovery log + REAP metric. Never throws — the reaper runs
 * silently ahead of every triage sweep and must not block it.
 */
export async function clearStaleLocks(staleMinutes = STALE_LOCK_MINUTES): Promise<ReapResult> {
  const db = getAdminClient();
  const cutoff = new Date(Date.now() - staleMinutes * 60_000).toISOString();

  const { data, error } = await db
    .from('tasks')
    .select('*')
    .eq('status', 'running')
    .lt('updated_at', cutoff)
    .limit(MAX_REAP_BATCH);

  if (error) {
    await hermesLog('error', `[REAPER] HALT: scan failed — ${error.message.replace(/\s+/g, ' ').slice(0, 160)}`);
    return { scanned: 0, recycled: 0 };
  }

  const stale = (data ?? []) as Task[];
  let recycled = 0;

  for (const task of stale) {
    // Optimistic guard (.eq status running) — a worker that finished between
    // scan and reap wins; agent freed by current_task_id match so orphaned
    // locks are released even when tasks.agent_id is out of sync.
    const [taskUpd, agentUpd] = await Promise.all([
      db
        .from('tasks')
        .update({ status: 'pending', result: null, updated_at: new Date().toISOString() })
        .eq('id', task.id)
        .eq('status', 'running'),
      db.from('agents').update({ status: 'idle', current_task_id: null }).eq('current_task_id', task.id),
    ]);
    if (taskUpd.error || agentUpd.error) {
      const msg = (taskUpd.error ?? agentUpd.error)?.message ?? 'unknown';
      await hermesLog('error', `[REAPER] HALT task=${task.id.slice(0, 8)}: ${msg.replace(/\s+/g, ' ').slice(0, 160)}`);
      continue;
    }
    recycled++;

    await recordModelEvent({
      model: task.model ?? 'unknown',
      event: 'REAP',
      taskId: task.id,
      agentId: task.agent_id ?? null,
      detail: `stale lock > ${staleMinutes}m recycled`,
    });
    await hermesLog(
      'warn',
      `[REAPER] RECOVERY: Agent heartbeat timeout. Task recycled to pending. task=${task.id.slice(0, 8)}`,
      task.agent_id ?? null
    );
  }

  return { scanned: stale.length, recycled };
}

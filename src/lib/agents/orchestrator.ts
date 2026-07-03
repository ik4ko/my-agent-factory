// Hermes orchestration core — two-phase design so the HTTP tick returns fast:
//
//   Phase 1  triageTick()        <1s   scan → route → state-lock → telemetry
//   Phase 2  executeDispatches() slow  streaming LLM workers (run via after()
//                                      in the tick route, off the HTTP path)
//
// Every transition is written to the realtime-replicated metrics/logs/tasks/
// agents tables, so the dashboard terminal renders the whole lifecycle live.
import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { findIdleAgent } from '@/lib/hermes/task-router';
import { runAgentWorker } from '@/lib/agents/runner';
import { routeModel, type Transition } from '@/lib/agents/model-router';
import { getSpendSnapshot, recordModelEvent } from '@/lib/telemetry/token-ledger';
import type { Agent, AgentType, Task } from '@/lib/types/database.types';

export interface Dispatch {
  taskId: string;
  agentId: string;
  agentType: AgentType;
  description: string;
  model: string;
  transition: Transition;
  reason: string;
}

export interface TriageResult {
  scanned: number;
  locked: number;
  skipped: number;
  halted: boolean;
  dispatches: Dispatch[];
}

async function resolveAgent(task: Task): Promise<Agent | null> {
  const db = getAdminClient();
  if (task.agent_id) {
    const { data } = await db
      .from('agents')
      .select('*')
      .eq('id', task.agent_id)
      .eq('status', 'idle')
      .or('paused.is.null,paused.eq.false')
      .maybeSingle();
    if (data) return data as Agent;
  }
  return findIdleAgent((task as { type?: AgentType }).type ?? 'generic');
}

/**
 * Phase 1 — rapid triage. Scans pending tasks (priority-ordered), routes a
 * model under the Fable budget cap, seats an idle agent, and state-locks the
 * pair (task → running, agent → busy) so a concurrent tick can't double-
 * dispatch. No LLM calls happen here. Any lock failure emits a single-line
 * HALT and stops the sweep.
 */
export async function triageTick(limit = 5): Promise<TriageResult> {
  const db = getAdminClient();
  const result: TriageResult = { scanned: 0, locked: 0, skipped: 0, halted: false, dispatches: [] };

  let snapshot;
  try {
    snapshot = await getSpendSnapshot(24);
  } catch (err) {
    await hermesLog('error', `[ORCH] HALT: ${String(err).replace(/\s+/g, ' ').slice(0, 200)}`);
    result.halted = true;
    return result;
  }

  const { data: tasks, error } = await db
    .from('tasks')
    .select('*')
    .eq('status', 'pending')
    .order('priority', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    await hermesLog('error', `[ORCH] HALT: task scan failed — ${error.message}`);
    result.halted = true;
    return result;
  }

  for (const task of (tasks ?? []) as Task[]) {
    result.scanned++;

    // Respect the human-in-the-loop gate: pending_approval tasks are untouchable.
    if (task.intervention_state === 'pending_approval') {
      result.skipped++;
      continue;
    }

    const agent = await resolveAgent(task);
    if (!agent) {
      result.skipped++;
      continue; // no capacity — next tick picks it up
    }

    const decision = routeModel(task.description, snapshot);

    try {
      await recordModelEvent({
        model: decision.model,
        event: decision.transition,
        taskId: task.id,
        agentId: agent.id,
        inputTokens: decision.inputTokens,
        detail: decision.reason,
      });

      // State lock — optimistic guard on current status so a concurrent tick
      // that already locked this pair is a no-op here.
      const [taskUpd, agentUpd] = await Promise.all([
        db
          .from('tasks')
          .update({ status: 'running', model: decision.model, updated_at: new Date().toISOString() })
          .eq('id', task.id)
          .eq('status', 'pending'),
        db
          .from('agents')
          .update({ status: 'busy', current_task_id: task.id })
          .eq('id', agent.id)
          .eq('status', 'idle'),
      ]);
      if (taskUpd.error) throw new Error(taskUpd.error.message);
      if (agentUpd.error) throw new Error(agentUpd.error.message);

      await hermesLog(
        'info',
        `[ORCH] ${decision.transition} ${task.id.slice(0, 8)} → ${decision.model} (${decision.reason})`,
        agent.id
      );

      result.locked++;
      result.dispatches.push({
        taskId: task.id,
        agentId: agent.id,
        agentType: (agent.type as AgentType) ?? 'generic',
        description: task.description,
        model: decision.model,
        transition: decision.transition,
        reason: decision.reason,
      });
    } catch (err) {
      const line = `[ORCH] HALT task=${task.id.slice(0, 8)} model=${decision.model}: ${String(err)
        .replace(/\s+/g, ' ')
        .slice(0, 200)}`;
      await Promise.all([
        hermesLog('error', line, agent.id),
        recordModelEvent({ model: decision.model, event: 'HALT', taskId: task.id, agentId: agent.id, detail: line }),
        db.from('tasks').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', task.id),
        db.from('agents').update({ status: 'error', current_task_id: null }).eq('id', agent.id),
      ]);
      result.halted = true;
      return result;
    }
  }

  return result;
}

/**
 * Phase 2 — background execution pool. Runs locked dispatches through the
 * streaming worker with bounded concurrency. runAgentWorker owns per-task
 * failure handling (failed status, HALT metric, single-line log), so one
 * crashed worker never takes down the pool.
 */
export async function executeDispatches(dispatches: Dispatch[], concurrency = 2): Promise<void> {
  const queue = [...dispatches];
  const lanes = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let d = queue.shift(); d; d = queue.shift()) {
      try {
        await runAgentWorker(d);
      } catch (err) {
        // Belt-and-braces: worker handles its own errors; this catches bugs in the worker itself.
        await hermesLog(
          'error',
          `[ORCH] HALT task=${d.taskId.slice(0, 8)} worker crash: ${String(err).replace(/\s+/g, ' ').slice(0, 200)}`,
          d.agentId
        );
      }
    }
  });
  await Promise.all(lanes);
}

/** Single-process sweep (triage + inline execution) — used outside HTTP contexts. */
export async function runOrchestratorTick(limit = 5): Promise<TriageResult> {
  const triage = await triageTick(limit);
  await executeDispatches(triage.dispatches);
  return triage;
}

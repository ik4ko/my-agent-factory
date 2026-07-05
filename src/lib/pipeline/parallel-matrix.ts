import { randomUUID } from 'crypto';
import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { findIdleAgent } from '@/lib/hermes/task-router';
import { runAgentWorker } from '@/lib/agents/runner';
import { commitMatrixToLongTermMemory } from '@/lib/pipeline/matrix-memory';
import type { AgentType } from '@/lib/types/database.types';

/**
 * Parallel Execution Matrix — Phase 3.
 *
 * One parent objective fans out to up to three agents SIMULTANEOUSLY
 * (Hermes/generic, Codex/coder, Scout/researcher), each with an independent
 * task row tagged `result.matrix = { id, role }`. Streams run concurrently:
 * each worker flushes its own task row, so the dashboard renders three live
 * thought streams at once, and the LiveTerminal's timestamp-sorted merge
 * keeps cross-agent telemetry strictly linear.
 *
 * Phase C — Cross-Debate: once the three lanes settle, the same three agents
 * cross-examine each other's output (Hermes↔Scout, Codex↔Hermes, Scout↔Codex),
 * streaming `[MATRIX:DEBATE:*]` critiques. The reconciled consensus is then
 * committed to long-term memory (gated row; see matrix-memory.ts).
 *
 * Concurrency safety: every lane and every debater owns a DISTINCT task row and
 * a DISTINCT agent row, and all writes are single-row upserts — there is no
 * lock-ordering cycle across the concurrent updates, so no deadlock. The only
 * shared table is append-only `logs`, whose inserts never block each other.
 */

export type MatrixRole = 'RESEARCH' | 'ANALYSIS' | 'RECON';

interface MatrixLaneSpec {
  role: MatrixRole;
  agentType: AgentType;
  buildSystemPrompt: (objective: string) => string;
  simulateOutput: (objective: string) => string;
}

const LANES: readonly MatrixLaneSpec[] = [
  {
    role: 'RESEARCH',
    agentType: 'generic',
    buildSystemPrompt: (o) =>
      `You are Hermes on a parallel scan lane. Independently produce a concise market research brief for: "${o}". Structure: LANDSCAPE | SIGNALS | RISKS. You share this objective with two sibling agents working in parallel — do not reference them; produce standalone findings.`,
    simulateOutput: (o) => `PARALLEL RESEARCH (SIMULATED) — landscape/signals/risks for "${o}".`,
  },
  {
    role: 'ANALYSIS',
    agentType: 'coder',
    buildSystemPrompt: (o) =>
      `You are Codex on a parallel scan lane. Independently produce a quantitative angle on: "${o}". Structure: QUANT FACTORS | TESTABLE CONDITIONS | WHAT WOULD FALSIFY THIS. Standalone; no cross-references.`,
    simulateOutput: (o) => `PARALLEL ANALYSIS (SIMULATED) — quant factors for "${o}".`,
  },
  {
    role: 'RECON',
    agentType: 'researcher',
    buildSystemPrompt: (o) =>
      `You are Scout on a parallel scan lane. Independently produce a reconnaissance sweep for: "${o}". Structure: SOURCES TO CHECK | CONTRARIAN VIEW | BLIND SPOTS. Standalone; no cross-references.`,
    simulateOutput: (o) => `PARALLEL RECON (SIMULATED) — contrarian sweep for "${o}".`,
  },
] as const;

// Cross-debate assignments: each debater critiques a SIBLING lane's output.
interface DebateSpec {
  name: 'HERMES' | 'CODEX' | 'SCOUT';
  agentType: AgentType;      // debater's own agent (reused from its lane)
  targetRole: MatrixRole;    // whose output it reviews
  dimension: string;
  simulateOutput: string;
}

const DEBATES: readonly DebateSpec[] = [
  { name: 'HERMES', agentType: 'generic',    targetRole: 'RECON',    dimension: "Scout's data completeness (RECON)",                       simulateOutput: 'CROSS-DEBATE (SIMULATED) — Hermes flags gaps in RECON completeness.' },
  { name: 'CODEX',  agentType: 'coder',      targetRole: 'RESEARCH', dimension: "the mathematical/technical viability of Hermes' findings", simulateOutput: 'CROSS-DEBATE (SIMULATED) — Codex stress-tests RESEARCH viability.' },
  { name: 'SCOUT',  agentType: 'researcher', targetRole: 'ANALYSIS', dimension: "Codex's queries/assumptions against real-time constraints", simulateOutput: 'CROSS-DEBATE (SIMULATED) — Scout checks ANALYSIS vs live constraints.' },
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface MatrixLaneResult {
  role: string;
  agent: string;
  taskId: string | null;
  status: 'dispatched' | 'no_agent' | 'failed';
}

export interface MatrixRunResult {
  matrixId: string;
  lanes: MatrixLaneResult[];
  debates: MatrixLaneResult[];
  memoryKey: string | null;
}

async function runSimulatedLane(taskId: string, agentId: string, output: string, tag?: Record<string, unknown>): Promise<void> {
  for (const fraction of [0.5, 1]) {
    await sleep(500 + Math.random() * 400); // staggered so streams interleave
    await db()
      .from('tasks')
      .update({
        result: {
          ...(tag ?? {}),
          streaming: fraction < 1,
          chars: Math.round(output.length * fraction),
          preview: output.slice(0, Math.round(output.length * fraction)),
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId);
  }
  await Promise.all([
    db().from('tasks').update({ status: 'completed' }).eq('id', taskId),
    db().from('agents').update({ status: 'idle', current_task_id: null }).eq('id', agentId),
  ]);
}

interface ClaimedLane {
  spec: MatrixLaneSpec;
  agentId: string;
  agentName: string;
  taskId: string;
}

/** Map each completed lane role → its captured output preview. */
async function readLaneOutputs(matrixId: string): Promise<Record<string, string>> {
  const { data } = await db()
    .from('tasks')
    .select('result')
    .filter('result->matrix->>id', 'eq', matrixId);
  const out: Record<string, string> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (data ?? []) as Array<{ result: any }>) {
    const role = r.result?.matrix?.role;
    if (typeof role === 'string' && !role.startsWith('DEBATE')) {
      out[role] = (r.result?.preview ?? '').toString();
    }
  }
  return out;
}

/**
 * Phase C — cross-debate. Reuses the three (now-idle) lane agents to critique
 * each other's output concurrently. Each critique is an independent task row
 * tagged `role: DEBATE:<name>`; streams flush under `[MATRIX:DEBATE:*]`.
 */
async function runCrossDebate(
  matrixId: string,
  objective: string,
  claimed: ClaimedLane[],
  simulate: boolean,
): Promise<MatrixLaneResult[]> {
  const outputs = await readLaneOutputs(matrixId);
  const byType = new Map(claimed.map((c) => [c.spec.agentType, c]));
  const results: MatrixLaneResult[] = [];

  await hermesLog('info', `Parallel matrix ${matrixId.slice(0, 8)} entering cross-debate round`);

  const settled = await Promise.allSettled(
    DEBATES.map(async (d) => {
      const lane = byType.get(d.agentType);
      const target = outputs[d.targetRole];
      if (!lane || target === undefined) {
        await hermesLog('warn', `[MATRIX:DEBATE:${d.name}] skipped — missing ${!lane ? 'agent' : 'target output'}`);
        results.push({ role: `DEBATE:${d.name}`, agent: d.name, taskId: null, status: 'no_agent' });
        return;
      }

      const { data, error } = await db()
        .from('tasks')
        .insert({
          description: `[MATRIX:DEBATE:${d.name}] ${objective}`,
          status: 'running',
          agent_id: lane.agentId,
          result: { matrix: { id: matrixId, role: `DEBATE:${d.name}`, phase: 'debate' } },
        })
        .select('id')
        .single();
      if (error || !data) {
        results.push({ role: `DEBATE:${d.name}`, agent: lane.agentName, taskId: null, status: 'failed' });
        return;
      }
      await db().from('agents').update({ status: 'busy', current_task_id: data.id }).eq('id', lane.agentId);

      await hermesLog('info', `[MATRIX:DEBATE:${d.name}] cross-examining ${d.dimension}`, lane.agentId);

      const debateTag = { matrix: { id: matrixId, role: `DEBATE:${d.name}`, phase: 'debate' } };
      if (simulate) {
        await runSimulatedLane(data.id, lane.agentId, d.simulateOutput, debateTag);
      } else {
        const critiquePrompt =
          `You are ${d.name} in a cross-examination round of a multi-agent matrix. ` +
          `Adversarially but fairly critique ${d.dimension}. Material under review:\n\n"""${target.slice(0, 1500)}"""\n\n` +
          `Produce exactly: VERDICT | GAPS | CORRECTIONS. Be terse. Do not restate the material.`;
        await runAgentWorker({
          taskId: data.id,
          agentId: lane.agentId,
          agentType: d.agentType,
          description: `[MATRIX:DEBATE:${d.name}] ${objective}`,
          systemPrompt: critiquePrompt,
          resultTag: debateTag,
        });
      }

      await hermesLog('success', `[MATRIX:DEBATE:${d.name}] critique of ${d.targetRole} complete`, lane.agentId);
      results.push({ role: `DEBATE:${d.name}`, agent: lane.agentName, taskId: data.id, status: 'dispatched' });
    }),
  );

  // Surface any rejected debate promise as a failed row (worker owns its own
  // task/agent error state; this is the belt-and-braces record).
  settled.forEach((res, i) => {
    if (res.status === 'rejected') {
      results.push({ role: `DEBATE:${DEBATES[i].name}`, agent: DEBATES[i].name, taskId: null, status: 'failed' });
    }
  });

  return results;
}

/** Fan an objective out across all matrix lanes with idle agents. */
export async function runParallelMatrix(
  objective: string,
  options: { simulate?: boolean } = {},
): Promise<MatrixRunResult> {
  const simulate = options.simulate ?? true;
  const matrixId = randomUUID();
  const lanes: MatrixLaneResult[] = [];

  // Phase A: claim agents + create all lane tasks FIRST, so the dashboard
  // shows the full matrix igniting at once.
  const claimed: ClaimedLane[] = [];
  for (const spec of LANES) {
    const agent = await findIdleAgent(spec.agentType);
    if (!agent) {
      lanes.push({ role: spec.role, agent: '(none idle)', taskId: null, status: 'no_agent' });
      continue;
    }
    const { data, error } = await db()
      .from('tasks')
      .insert({
        description: `[MATRIX ${spec.role}] ${objective}`,
        status: 'running',
        agent_id: agent.id,
        result: { matrix: { id: matrixId, role: spec.role } },
      })
      .select('id')
      .single();
    if (error || !data) {
      lanes.push({ role: spec.role, agent: agent.name, taskId: null, status: 'failed' });
      continue;
    }
    await db().from('agents').update({ status: 'busy', current_task_id: data.id }).eq('id', agent.id);
    claimed.push({ spec, agentId: agent.id, agentName: agent.name, taskId: data.id });
  }

  await hermesLog(
    'info',
    `Parallel matrix ${matrixId.slice(0, 8)} ignited — ${claimed.length}/${LANES.length} lanes${simulate ? ' (SANDBOX)' : ''}: ${claimed.map((c) => c.agentName).join(' + ')}`,
  );

  // Phase B: run every claimed lane CONCURRENTLY, each isolated.
  const settled = await Promise.allSettled(
    claimed.map(async ({ spec, agentId, agentName, taskId }) => {
      const laneTag = { matrix: { id: matrixId, role: spec.role } };
      if (simulate) {
        await runSimulatedLane(taskId, agentId, spec.simulateOutput(objective), laneTag);
      } else {
        await runAgentWorker({
          taskId,
          agentId,
          agentType: spec.agentType,
          description: `[MATRIX ${spec.role}] ${objective}`,
          systemPrompt: spec.buildSystemPrompt(objective),
          resultTag: laneTag,
        });
      }
      return { role: spec.role, agent: agentName, taskId };
    }),
  );

  settled.forEach((res, i) => {
    const { spec, agentName, taskId } = claimed[i];
    if (res.status === 'fulfilled') {
      lanes.push({ role: spec.role, agent: agentName, taskId, status: 'dispatched' });
    } else {
      lanes.push({ role: spec.role, agent: agentName, taskId, status: 'failed' });
    }
  });

  const ok = lanes.filter((l) => l.status === 'dispatched').length;
  await hermesLog(
    'success',
    `Parallel matrix ${matrixId.slice(0, 8)} lanes complete — ${ok}/${lanes.length} finished`,
  );

  // Phase C: cross-debate over the lane outputs, then commit consensus.
  const debates = await runCrossDebate(matrixId, objective, claimed, simulate);

  const memory = await commitMatrixToLongTermMemory(matrixId);
  await hermesLog(
    'success',
    `Parallel matrix ${matrixId.slice(0, 8)} debate + memory commit done${memory ? ` — ${memory.key}` : ' — (no memory row)'}`,
  );

  return { matrixId, lanes, debates, memoryKey: memory?.key ?? null };
}

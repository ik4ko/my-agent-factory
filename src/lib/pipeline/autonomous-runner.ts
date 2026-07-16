import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { startPipeline, executeStep } from './engine';

/**
 * Autonomous strategy ignition — Phase 6.
 *
 * A server-side clock-pulse that periodically launches the RESEARCH →
 * ANALYSIS → EXECUTION pipeline against a rotating macro-asset target list,
 * with no operator command required.
 *
 * SAFETY MODEL (unchanged by autonomy):
 *  - The pipeline's terminal action is STAGING a PENDING order proposal.
 *    Autonomy generates proposals faster; it does not (and must not) touch
 *    the human approval gate. Nothing in this codebase executes orders.
 *  - Kill switch: at most MAX_DAILY_AUTONOMOUS_TRADES autonomous pipeline
 *    ignitions per UTC calendar day, counted from the DATABASE (step-0 tasks
 *    with trigger='autonomous'), not from process memory — so restarts and
 *    parallel instances can't reset the ceiling.
 *  - On breach: hard-abort the loop, halt the Executor agent (halted_at +
 *    status 'error' + metadata.critical_halt — the schema's status check
 *    constraint has no 'CRITICAL_HALT' value, and halted_at is this app's
 *    existing halt semantic, rendering the red HALTED badge), and log the
 *    CRITICAL line.
 *  - Re-arming after a halt is a HUMAN action (clear halted_at), not code.
 */

export const MAX_DAILY_AUTONOMOUS_TRADES = 3 as const;

/** Rotating macro-asset targets for autonomous scans. */
export const AUTONOMOUS_TARGETS = ['SPY', 'QQQ', 'SOXS'] as const;

export const CRITICAL_HALT_MESSAGE =
  'Autonomous trade velocity ceiling reached. Activation paused for risk mitigation.';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

/** UTC start of the current calendar day, ISO. */
function utcDayStartIso(): string {
  return `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
}

/** Count autonomous pipeline ignitions (step-0 tasks) today, from the DB. */
export async function countAutonomousIgnitionsToday(): Promise<number> {
  const { count, error } = await db()
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', utcDayStartIso())
    .filter('result->pipeline->>trigger', 'eq', 'autonomous')
    .filter('result->pipeline->>step', 'eq', '0');
  if (error) throw new Error(error.message ?? 'ignition count query failed');
  return count ?? 0;
}

/** Halt the Executor agent and emit the CRITICAL log line. Idempotent. */
async function executeCriticalHalt(): Promise<void> {
  const now = new Date().toISOString();
  const { data: executor } = await db()
    .from('agents')
    .select('id, halted_at, metadata')
    .ilike('name', 'Executor%')
    .limit(1)
    .maybeSingle();

  if (executor && !executor.halted_at) {
    await db()
      .from('agents')
      .update({
        status: 'error',
        halted_at: now,
        current_task_id: null,
        metadata: {
          ...(executor.metadata ?? {}),
          critical_halt: true,
          critical_halt_reason: CRITICAL_HALT_MESSAGE,
          critical_halt_at: now,
        },
      })
      .eq('id', executor.id);
  }

  await hermesLog('error', `CRITICAL: ${CRITICAL_HALT_MESSAGE}`, executor?.id ?? null);
}

/** True when the Executor is currently halted (autonomy must not run). */
async function executorHalted(): Promise<boolean> {
  const { data } = await db()
    .from('agents')
    .select('halted_at')
    .ilike('name', 'Executor%')
    .limit(1)
    .maybeSingle();
  return Boolean(data?.halted_at);
}

export interface AutonomousTickResult {
  status: 'dispatched' | 'ceiling_halt' | 'executor_halted' | 'error';
  target?: string;
  pipelineId?: string;
  ignitionsToday: number;
}

/**
 * One clock-pulse: enforce the kill switch, pick the next target, ignite a
 * LIVE pipeline run. Exported separately so a real cron route can drive it.
 */
export async function runAutonomousTick(): Promise<AutonomousTickResult> {
  let ignitionsToday = 0;
  try {
    if (await executorHalted()) {
      return { status: 'executor_halted', ignitionsToday: -1 };
    }

    ignitionsToday = await countAutonomousIgnitionsToday();
    if (ignitionsToday >= MAX_DAILY_AUTONOMOUS_TRADES) {
      await executeCriticalHalt();
      return { status: 'ceiling_halt', ignitionsToday };
    }

    // Rotate deterministically through the macro targets by ignition count.
    const target = AUTONOMOUS_TARGETS[ignitionsToday % AUTONOMOUS_TARGETS.length];
    const objective = `Autonomous macro scan: evaluate a defined-risk options entry on ${target} under current regime conditions`;

    const dispatch = await startPipeline(objective, {
      simulate: false,
      trigger: 'autonomous',
    });
    await hermesLog(
      'info',
      `Autonomous ignition ${ignitionsToday + 1}/${MAX_DAILY_AUTONOMOUS_TRADES} → ${target} (pipeline ${dispatch.context.id.slice(0, 8)})`,
    );
    await executeStep(dispatch);

    return {
      status: 'dispatched',
      target,
      pipelineId: dispatch.context.id,
      ignitionsToday: ignitionsToday + 1,
    };
  } catch (err) {
    await hermesLog(
      'error',
      `Autonomous tick failed: ${String(err).replace(/\s+/g, ' ').slice(0, 160)}`,
    );
    return { status: 'error', ignitionsToday };
  }
}

let loopHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Start the autonomy clock-pulse. Singleton per process; a ceiling breach
 * hard-aborts the loop (clearInterval) — it does NOT merely skip ticks, so
 * a halted system stays halted until a human re-arms the Executor and calls
 * this again. Suited to a long-lived server; on serverless, drive
 * `runAutonomousTick` from a cron route instead.
 */
export function initializeAutonomousLoop(intervalMs: number): () => void {
  if (loopHandle) {
    return stopAutonomousLoop; // already armed — return the existing disposer
  }
  const safeInterval = Math.max(60_000, intervalMs); // never faster than 1/min

  loopHandle = setInterval(() => {
    void runAutonomousTick().then((result) => {
      if (result.status === 'ceiling_halt') stopAutonomousLoop();
    });
  }, safeInterval);

  void hermesLog(
    'info',
    `Autonomous loop armed — pulse every ${Math.round(safeInterval / 1000)}s, ceiling ${MAX_DAILY_AUTONOMOUS_TRADES}/day`,
  );
  return stopAutonomousLoop;
}

export function stopAutonomousLoop(): void {
  if (loopHandle) {
    clearInterval(loopHandle);
    loopHandle = null;
  }
}

import { randomUUID } from 'crypto';
import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import {
  publishBusEvent,
  fetchPendingHandOffs,
  claimBusEvent,
  markBusEventFailed,
} from '@/lib/bus/system-bus';
import { findIdleAgent } from '@/lib/hermes/task-router';
import { runAgentWorker } from '@/lib/agents/runner';
import { PLAYBOOKS, MARKET_STRATEGY_PLAYBOOK } from './playbook';
import { loadChannelContext } from '@/lib/content/channels';
import { PipelineContextSchema } from './types';
import type { ChannelContext, PipelineContext, PipelinePlaybook, PlaybookStep, StepDispatch } from './types';
import type { Agent } from '@/lib/types/database.types';

/**
 * Pipeline engine — sequential multi-agent hand-off.
 *
 * Storage model: pipeline metadata rides in `tasks.result.pipeline` (JSONB,
 * zod-validated). This is additive — no migration, works against the live
 * schema today, and every step is an ordinary `tasks` row so the existing
 * realtime channels (agents/tasks/logs) stream the whole run into the
 * dashboard with zero new subscriptions.
 *
 * Column-upgrade path (optional, later): promote `pipeline_id/step/role` to
 * real columns + composite index if pipelines need server-side querying.
 *
 * Hand-off flow:
 *   startPipeline → executeStep(step 0)
 *     live worker path: runAgentWorker → (on success) advancePipelineAfterTask
 *     simulate path:    runSimulatedStep → advancePipelineAfterTask
 *   advance persists the FULL step output, then dispatches the next step to
 *   the next idle agent — recursively until the chain completes.
 *
 * The full prior output is carried in-process (workers only persist a 400-char
 * preview); `pendingHandOffs` bridges the runner's completion hook back to the
 * engine within the same serverless invocation, with a DB fallback parse.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** In-invocation bridge: taskId → context + prior output (see header). */
const pendingHandOffs = new Map<string, { context: PipelineContext; priorOutput: string | null }>();

function getPlaybook(name: string): PipelinePlaybook {
  return PLAYBOOKS[name] ?? MARKET_STRATEGY_PLAYBOOK;
}

/** Prefer the step's named agent (e.g. a seeded 'Executor'); fall back to any
 *  idle agent of the step's type; null = run the step virtually. */
async function findStepAgent(step: PlaybookStep): Promise<Agent | null> {
  const { data } = await db()
    .from('agents')
    .select('*')
    .eq('status', 'idle')
    .ilike('name', `${step.nameHint}%`)
    .limit(1)
    .maybeSingle();
  if (data) return data as Agent;
  return findIdleAgent(step.agentType);
}

async function createStepTask(
  context: PipelineContext,
  description: string,
  agentId: string | null,
): Promise<string> {
  const { data, error } = await db()
    .from('tasks')
    .insert({
      description,
      status: 'pending',
      agent_id: agentId,
      // The first real writer of assigned_lane. src/lib/rooms/scope.ts scopes
      // the content room off this column instead of a description regex, so
      // every content step task MUST carry its channel slug here.
      ...(context.channelSlug ? { assigned_lane: context.channelSlug } : {}),
      result: { pipeline: context },
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Failed to create pipeline step task');
  return (data as { id: string }).id;
}

async function markStepRunning(taskId: string, agentId: string | null): Promise<void> {
  await Promise.all([
    db().from('tasks').update({ status: 'running' }).eq('id', taskId),
    agentId
      ? db().from('agents').update({ status: 'busy', current_task_id: taskId }).eq('id', agentId)
      : Promise.resolve(),
  ]);
}

/** Persist the full step output (context survives worker preview overwrites). */
async function persistStepOutput(
  taskId: string,
  context: PipelineContext,
  output: string,
): Promise<void> {
  await db()
    .from('tasks')
    .update({
      status: 'completed',
      result: {
        pipeline: context,
        output,
        preview: output.slice(-400),
        chars: output.length,
        streaming: false,
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId);
}

async function buildDispatch(
  context: PipelineContext,
  priorOutput: string | null,
): Promise<StepDispatch> {
  const playbook = getPlaybook(context.playbook);
  const step = playbook.steps[context.step];
  const agent = await findStepAgent(step);
  const description = step.describe(context.objective);
  const taskId = await createStepTask(context, description, agent?.id ?? null);
  return {
    context,
    taskId,
    agentId: agent?.id ?? null,
    agentName: agent?.name ?? `${step.nameHint} (virtual)`,
    description,
    priorOutput,
  };
}

/** Start a new pipeline run: creates the step-1 task and returns its dispatch.
 *  Call `executeStep` with the result (typically inside `after()`). */
export async function startPipeline(
  objective: string,
  options: {
    simulate?: boolean;
    playbook?: string;
    trigger?: 'manual' | 'autonomous';
    /** Content runs only: binds every step task to a content_channels row via
     *  assigned_lane, and injects the channel's voice into each prompt. */
    channel?: { id: string; slug: string };
  } = {},
): Promise<StepDispatch> {
  const playbook = getPlaybook(options.playbook ?? MARKET_STRATEGY_PLAYBOOK.name);
  const context: PipelineContext = {
    id: randomUUID(),
    playbook: playbook.name,
    step: 0,
    role: playbook.steps[0].role,
    objective,
    simulate: options.simulate ?? true,
    trigger: options.trigger ?? 'manual',
    ...(options.channel ? { channelId: options.channel.id, channelSlug: options.channel.slug } : {}),
  };
  await hermesLog(
    'info',
    `Pipeline ${context.id.slice(0, 8)} started (${playbook.steps.length} stages${context.simulate ? ', SANDBOX' : ''}${context.channelSlug ? `, channel=${context.channelSlug}` : ''}): "${objective.slice(0, 60)}"`,
  );
  return buildDispatch(context, null);
}

/** Execute one step: live model worker or sandbox simulation. */
export async function executeStep(dispatch: StepDispatch): Promise<void> {
  const { context, taskId, agentId, agentName, description, priorOutput } = dispatch;
  const playbook = getPlaybook(context.playbook);
  const step = playbook.steps[context.step];

  await markStepRunning(taskId, agentId);
  await hermesLog(
    'info',
    `[${context.role}] stage ${context.step + 1}/${playbook.steps.length} → ${agentName}`,
    agentId,
  );

  // Executor's deterministic scan (Phase 5): parse the ANALYSIS output,
  // apply the E>0 and capped-Kelly constraints in code, and stage an
  // immutable PENDING order for human review. Runs before the narrative
  // plan generation and never throws.
  if (step.role === 'EXECUTION') {
    const { stageOrderFromAnalysis } = await import('@/lib/trading/stage');
    await stageOrderFromAnalysis(context, priorOutput, agentId);
  }

  // Per-channel runtime context (content playbook only; null everywhere
  // else). Loaded before the simulate branch so a sandbox trace shows the
  // same channel voice a live run would use.
  const channel = await loadChannelContext(context.channelId);

  // Per-stage gate: a live run still simulates any stage whose integration
  // has no credentials, so a partially-wired playbook completes end-to-end
  // rather than dying at the first unwired stage. Steps without the gate keep
  // the previous all-or-nothing behavior.
  const stageConfigured = step.isConfigured?.() ?? true;
  if (context.simulate || !stageConfigured) {
    if (!context.simulate && !stageConfigured) {
      await hermesLog(
        'warn',
        `[${context.role}] integration not configured — stage simulated inside a live run`,
        agentId,
      );
    }
    await runSimulatedStep(dispatch, step, channel);
    return;
  }

  if (!agentId) {
    // Live mode requires a real agent row; fail the step cleanly.
    await db().from('tasks').update({ status: 'failed' }).eq('id', taskId);
    await hermesLog('error', `[${context.role}] no idle agent available — pipeline halted`);
    return;
  }

  // Live telemetry injection (Phase 7): RESEARCH pulls real market context
  // and it lands in the system prompt server-side — un-overrideable by the
  // operator's objective text or any model output. Sandbox runs never touch
  // the network; a failed pull degrades to the formula-only prompt.
  let market: import('@/lib/market/fetcher').MarketContext | null = null;
  if (step.role === 'RESEARCH') {
    try {
      const { getMarketContext, extractTickerFromObjective } = await import('@/lib/market/fetcher');
      market = await getMarketContext(extractTickerFromObjective(context.objective));
      await hermesLog(
        'info',
        `Pulled live telemetry for ${market.ticker} (Price: $${market.price.toFixed(2)}, RSI: ${market.rsi14.toFixed(1)}). Forwarding payload to Hermes Core...`,
        agentId,
      );
    } catch (err) {
      market = null;
      await hermesLog(
        'warn',
        `Telemetry pull failed — Hermes runs formula-only: ${String(err).slice(0, 100)}`,
        agentId,
      );
    }
  }

  // Bridge for the runner's completion hook (same invocation).
  pendingHandOffs.set(taskId, { context, priorOutput });
  await runAgentWorker({
    taskId,
    agentId,
    agentType: step.agentType,
    description,
    systemPrompt: step.buildSystemPrompt(context.objective, priorOutput, market, channel),
    // Stage-bound lane (e.g. SCRIPT → Haiku). Undefined keeps the router's
    // default worker, which is what every market-strategy step does.
    ...(step.resolveModel?.() ? { model: step.resolveModel()! } : {}),
    // Expanded budget: the playbook's density directive asks for exhaustive
    // institutional briefings; the default 2048 would truncate them and feed
    // a clipped brief to the next stage.
    maxTokens: 4096,
  });
  pendingHandOffs.delete(taskId); // worker failed or hook already consumed it
}

/** Sandbox path: deterministic output, realistic status/heartbeat cadence,
 *  zero model calls, zero external APIs. Everything else is real DB writes,
 *  so the dashboard traces the run exactly like a live one. */
async function runSimulatedStep(
  dispatch: StepDispatch,
  step: PlaybookStep,
  channel: ChannelContext | null = null,
): Promise<void> {
  const { context, taskId, agentId, agentName } = dispatch;
  const output = step.simulateOutput(context.objective, dispatch.priorOutput, channel);

  // Two streaming flushes so realtime task previews have intermediate states.
  for (const fraction of [0.4, 1]) {
    await sleep(700);
    await db()
      .from('tasks')
      .update({
        result: {
          pipeline: context,
          streaming: fraction < 1,
          chars: Math.round(output.length * fraction),
          preview: output.slice(0, Math.round(output.length * fraction)).slice(-400),
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId);
  }

  await persistStepOutput(taskId, context, output);
  if (agentId) {
    await db().from('agents').update({ status: 'idle', current_task_id: null }).eq('id', agentId);
  }
  await hermesLog('success', `[${context.role}] ${agentName} complete (${output.length} chars, simulated)`, agentId);

  await advancePipelineAfterTask(taskId, output);
}

/**
 * Hand-off hook. Called by the runner after any successful task (no-op for
 * non-pipeline tasks) and by the simulator. Persists the full output, then
 * dispatches the next step — or closes the pipeline after the final stage.
 */
export async function advancePipelineAfterTask(taskId: string, output: string): Promise<void> {
  // Fast path: same-invocation bridge. Fallback: parse context from the row
  // (survives if the task was created by an earlier invocation).
  let bridged = pendingHandOffs.get(taskId) ?? null;
  pendingHandOffs.delete(taskId);
  if (!bridged) {
    const { data } = await db().from('tasks').select('result').eq('id', taskId).maybeSingle();
    const parsed = PipelineContextSchema.safeParse(
      (data?.result as Record<string, unknown> | null)?.pipeline,
    );
    if (!parsed.success) return; // ordinary task — nothing to do
    bridged = { context: parsed.data, priorOutput: null };
  }

  const { context } = bridged;
  const playbook = getPlaybook(context.playbook);

  // Re-persist context + full output (live workers overwrite result with previews).
  await persistStepOutput(taskId, context, output);

  const nextIndex = context.step + 1;
  if (nextIndex >= playbook.steps.length) {
    await publishBusEvent({
      topic: 'pipeline.completed',
      agent: context.role,
      pipelineId: context.id,
      taskId,
      payload: { objective: context.objective, stages: playbook.steps.length, simulate: context.simulate },
    });
    await hermesLog(
      'success',
      `Pipeline ${context.id.slice(0, 8)} complete — strategy generated (${playbook.steps.length} stages${context.simulate ? ', SANDBOX' : ''})`,
    );
    return;
  }

  // Federated room: PUBLISH the hand-off (full output rides in the payload,
  // durably — an invocation death between publish and pump loses nothing),
  // then pump. The pump is also invocable from cron to recover orphans.
  const nextContext: PipelineContext = {
    ...context,
    step: nextIndex,
    role: playbook.steps[nextIndex].role,
  };
  await publishBusEvent({
    topic: 'pipeline.step.completed',
    agent: context.role,
    pipelineId: context.id,
    taskId,
    payload: { nextContext, output },
  });
  await hermesLog(
    'info',
    `Hand-off published to system_bus: ${context.role} → ${nextContext.role} (${output.length} chars)`,
  );

  await pumpSystemBus();
}

/**
 * The federated room's subscriber side: claim pending hand-off events
 * (atomic compare-and-set — concurrent pumps can't double-process) and
 * execute the next step for each. Returns the number processed. Safe to
 * call from anywhere, including a recovery cron.
 */
export async function pumpSystemBus(limit = 5): Promise<number> {
  let events;
  try {
    events = await fetchPendingHandOffs(limit);
  } catch (err) {
    await hermesLog('error', `Bus pump: fetch failed — ${String(err).slice(0, 120)}`);
    return 0;
  }

  let processed = 0;
  for (const event of events) {
    if (!(await claimBusEvent(event.id))) continue; // another pump won the race
    try {
      const parsedContext = PipelineContextSchema.safeParse(event.payload.nextContext);
      const output = typeof event.payload.output === 'string' ? event.payload.output : null;
      if (!parsedContext.success) {
        await markBusEventFailed(event.id);
        await hermesLog('error', `Bus pump: event ${event.id.slice(0, 8)} carries an invalid context — marked failed`);
        continue;
      }
      const dispatch = await buildDispatch(parsedContext.data, output);
      await executeStep(dispatch);
      processed += 1;
    } catch (err) {
      await markBusEventFailed(event.id);
      await hermesLog('error', `Bus pump: event ${event.id.slice(0, 8)} failed — ${String(err).slice(0, 120)}`);
    }
  }
  return processed;
}

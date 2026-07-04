import { NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';
import { startPipeline, executeStep } from '@/lib/pipeline/engine';
import type { PipelineRunResponse } from '@/lib/pipeline/types';

/**
 * POST /api/pipeline/run — launch a sequential multi-agent pipeline.
 *
 * Body: { objective: string; simulate?: boolean (default true); playbook?: string }
 *
 * `simulate: true` (the default) runs the full RESEARCH → ANALYSIS → EXECUTION
 * chain in the sandbox: real tasks/agents/logs rows (so the dashboard traces
 * every stage live over the existing realtime channels), zero Anthropic calls,
 * zero external broker APIs. Live mode requires idle agents and calls the
 * model per stage; the EXECUTION stage is PAPER-MODE-only in both cases.
 *
 * The chain executes via `after()` — the response returns immediately with
 * the pipeline id while the stages run and hand off sequentially.
 */

const RunSchema = z.object({
  objective: z.string().min(1, 'Objective cannot be empty').max(1000, 'Objective too long'),
  simulate: z.boolean().optional().default(true),
  playbook: z.string().optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = RunSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  let dispatch;
  try {
    dispatch = await startPipeline(parsed.data.objective, {
      simulate: parsed.data.simulate,
      playbook: parsed.data.playbook,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to start pipeline: ${String(err).slice(0, 200)}` },
      { status: 500 },
    );
  }

  // Run the chain after the response flushes; each stage dispatches the next.
  after(async () => {
    await executeStep(dispatch);
  });

  const payload: PipelineRunResponse = {
    pipelineId: dispatch.context.id,
    playbook: dispatch.context.playbook,
    simulate: dispatch.context.simulate,
    firstStage: {
      role: dispatch.context.role,
      taskId: dispatch.taskId,
      agent: dispatch.agentName,
    },
  };
  return NextResponse.json(payload);
}

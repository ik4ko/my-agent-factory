import { NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';
import { runHermesCommand } from '@/lib/hermes';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { runAgentWorker } from '@/lib/agents/runner';

const CommandSchema = z.object({
  command: z.string().min(1, 'Command cannot be empty').max(1000, 'Command too long'),
  /** Client-side submit timestamp (ISO 8601) — used for transport-latency telemetry. */
  issuedAt: z.string().datetime({ offset: true }).optional(),
  /** Dispatch contract: Hermes only routes to idle agents; anything else is
   *  rejected. `agentType` pins routing to a room's agent type (set by the
   *  room composers); omitted = intent-parser routing. */
  target: z
    .object({
      status: z.literal('idle'),
      agentType: z.enum(['generic', 'coder', 'researcher', 'browser', 'planner']).optional(),
    })
    .optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = CommandSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Transport-latency telemetry: how long the command spent between the
  // dashboard submit and reaching the orchestration layer.
  if (parsed.data.issuedAt) {
    const latencyMs = Date.now() - Date.parse(parsed.data.issuedAt);
    if (Number.isFinite(latencyMs) && latencyMs >= 0 && latencyMs < 60_000) {
      await hermesLog('debug', `Command transport latency ${latencyMs}ms`);
    }
  }

  const result = await runHermesCommand(parsed.data.command, {
    pinnedAgentType: parsed.data.target?.agentType,
  });

  // Fire the worker agent after the response is sent to the client.
  // `after()` extends the serverless function lifetime beyond the response flush.
  if (result.status === 'dispatched' && result.taskId && result.agentId) {
    const { taskId, agentId } = result;
    after(async () => {
      await runAgentWorker({
        taskId,
        agentId,
        agentType: result.intent.agentType,
        description: result.intent.description,
      });
    });
  }

  return NextResponse.json(result);
}

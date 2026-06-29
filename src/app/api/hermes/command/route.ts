import { NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';
import { runHermesCommand } from '@/lib/hermes';
import { runAgentWorker } from '@/lib/agents/runner';

const CommandSchema = z.object({
  command: z.string().min(1, 'Command cannot be empty').max(1000, 'Command too long'),
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

  const result = await runHermesCommand(parsed.data.command);

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

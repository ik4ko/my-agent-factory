import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { parseToolCalls } from '@/lib/sandbox/parser';
import { executeToolCalls, formatToolResults } from '@/lib/sandbox/runner';
import type { Task } from '@/lib/types/database.types';

const Schema = z.object({
  taskId: z.string().uuid(),
  // Full agent transcript to scan (tasks.result stores only a rolling
  // preview); callers pass the complete text they want parsed for tool calls.
  text: z.string().max(500_000).optional(),
});

interface StreamPreview {
  preview?: string;
}

// Tool gate — parses an agent's output for tool-call blocks and routes them
// through the sandbox runner. Auth-gated by middleware. Only UP/DOWN-lane
// tasks may drive tools (SEAT is the fast/validation lane and stays read-only).
// The endpoint returns the formatted results so the worker loop can append
// them to context and let the model react to its own command outputs.
export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }
  const { taskId, text } = parsed.data;

  try {
    const db = getAdminClient();
    const { data, error } = await db.from('tasks').select('*').eq('id', taskId).maybeSingle();
    if (error) throw new Error(error.message);
    const task = data as Task | null;
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    if (task.assigned_lane !== 'UP' && task.assigned_lane !== 'DOWN') {
      return NextResponse.json(
        { error: `tool execution is UP/DOWN-lane only (task lane: ${task.assigned_lane ?? 'none'})` },
        { status: 403 }
      );
    }

    const source = text ?? (task.result as StreamPreview | null)?.preview ?? '';
    const { calls, errors } = parseToolCalls(source);

    for (const e of errors) await hermesLog('warn', `[EXEC] parse: ${e}`, task.agent_id ?? null);
    if (calls.length === 0) {
      return NextResponse.json({ executed: 0, results: [], parseErrors: errors, feedback: '' });
    }

    const results = await executeToolCalls(taskId, calls);
    const feedback = formatToolResults(results);

    return NextResponse.json({
      executed: results.length,
      results,
      parseErrors: errors,
      feedback, // append to agent context for the next reasoning turn
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Execution failed' },
      { status: 500 }
    );
  }
}

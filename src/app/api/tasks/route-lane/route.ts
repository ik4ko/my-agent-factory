import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { routeTask } from '@/lib/orchestrator/router';
import { getSpendSnapshot } from '@/lib/telemetry/token-ledger';
import type { AgentType, Task } from '@/lib/types/database.types';

const Schema = z.object({
  taskId: z.string().uuid().optional(), // omit → batch-evaluate unrouted pending tasks
  codeContext: z.string().max(200_000).optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

interface RoutedRow {
  taskId: string;
  lane: string;
  model: string;
  staged: boolean;
  reason: string;
}

// Lane evaluation hook. For each unrouted pending task: run the heuristic
// router, inject the factory system prompt + assigned_lane + model onto the
// row (realtime-replicated → fleet chips light up), and stage UP-lane tasks
// behind the existing human-approval gate (intervention_state).
export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }
  const { taskId, codeContext, limit } = parsed.data;

  try {
    const db = getAdminClient();
    const snapshot = await getSpendSnapshot(24);

    let query = db.from('tasks').select('*').eq('status', 'pending').is('assigned_lane', null);
    query = taskId ? query.eq('id', taskId) : query.limit(limit ?? 10);
    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const routed: RoutedRow[] = [];
    for (const task of (data ?? []) as Task[]) {
      const decision = routeTask(
        {
          description: task.description,
          codeContext,
          agentType: (task as { type?: AgentType }).type,
        },
        snapshot
      );

      const { error: updErr } = await db
        .from('tasks')
        .update({
          assigned_lane: decision.lane,
          model: decision.model,
          system_prompt: decision.systemPrompt,
          updated_at: new Date().toISOString(),
          ...(decision.requiresApproval
            ? {
                intervention_state: 'pending_approval' as const,
                intervention_request: `UP-lane (Fable) dispatch requires approval — ${decision.reason}`,
              }
            : {}),
        })
        .eq('id', task.id)
        .eq('status', 'pending');
      if (updErr) throw new Error(updErr.message);

      await hermesLog(
        decision.requiresApproval ? 'warn' : 'info',
        `[ROUTER] ${decision.lane} ${task.id.slice(0, 8)} → ${decision.model}${decision.requiresApproval ? ' [STAGED — awaiting approval]' : ''} (${decision.reason})`
      );

      routed.push({
        taskId: task.id,
        lane: decision.lane,
        model: decision.model,
        staged: decision.requiresApproval,
        reason: decision.reason,
      });
    }

    return NextResponse.json({ evaluated: routed.length, routed });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Lane routing failed' },
      { status: 500 }
    );
  }
}

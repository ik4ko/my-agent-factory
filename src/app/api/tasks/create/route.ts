import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import type { Task } from '@/lib/types/database.types';

// tasks has RLS enabled with no policies, so browser anon inserts are blocked
// by design. The command bar posts here; this route inserts via the service-
// role client (auth-gated by middleware). New rows land status='pending',
// assigned_lane=null → picked up by /api/tasks/route-lane then triageTick.
const Schema = z.object({
  prompt: z.string().trim().min(1, 'empty prompt').max(4000),
  priority: z.number().int().min(1).max(10).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' }, { status: 400 });
  }
  const { prompt, priority } = parsed.data;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getAdminClient() as any;
    const { data, error } = await db
      .from('tasks')
      .insert({
        description: prompt,
        status: 'pending',
        assigned_lane: null,
        priority: priority ?? 5,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    const task = data as Task;
    await hermesLog('info', `[TASK] queued ${task.id.slice(0, 8)} — "${prompt.slice(0, 60)}${prompt.length > 60 ? '…' : ''}"`);
    return NextResponse.json({ id: task.id, status: task.status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Task create failed' },
      { status: 500 }
    );
  }
}

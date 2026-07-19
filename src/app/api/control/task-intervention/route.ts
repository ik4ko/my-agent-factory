import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminClient } from '@/lib/supabase/admin';

const Schema = z.object({
  taskId: z.string().uuid(),
  decision: z.enum(['approve', 'deny']),
  feedback: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid intervention payload' }, { status: 400 });
  const { taskId, decision, feedback } = parsed.data;

  try {
    const db = getAdminClient();
    // Pending-only transition and immutable event insert share one DB
    // transaction. Replays and attempted approve-after-deny reversals fail.
    const { data: accepted, error } = await db.rpc('decide_task_intervention', {
      p_task_id: taskId,
      p_decision: decision,
      p_feedback: feedback ?? null,
    });
    if (error) throw error;
    if (!accepted) {
      return NextResponse.json({ error: 'Task intervention is not pending or was already decided' }, { status: 409 });
    }
    await db.from('logs').insert({
      level: decision === 'approve' ? 'success' : 'warn',
      message: `[INTERVENTION] Task ${taskId.slice(0, 8)} ${decision === 'approve' ? 'APPROVED' : 'DENIED'}${feedback ? ` — "${feedback}"` : ''}`,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Intervention failed' }, { status: 500 });
  }
}

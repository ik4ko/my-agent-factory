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
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid intervention payload' }, { status: 400 });
  }
  const { taskId, decision, feedback } = parsed.data;

  try {
    const db = getAdminClient();
    const approved = decision === 'approve';

    const { error } = await db
      .from('tasks')
      .update({
        intervention_state: approved ? 'approved' : 'denied',
        intervention_feedback: feedback ?? null,
        // Approving resumes the run; denying cancels the task.
        status: approved ? 'running' : 'cancelled',
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId);
    if (error) throw error;

    await db.from('logs').insert({
      level: approved ? 'success' : 'warn',
      message: `[INTERVENTION] Task ${taskId.slice(0, 8)} ${approved ? 'APPROVED' : 'DENIED'}${feedback ? ` — "${feedback}"` : ''}`,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Intervention failed' },
      { status: 500 }
    );
  }
}

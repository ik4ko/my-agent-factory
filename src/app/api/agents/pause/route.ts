import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminClient } from '@/lib/supabase/admin';

const Schema = z.object({
  agentId: z.string().uuid(),
  paused: z.boolean(),
});

export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'pause requires agentId and paused flag' }, { status: 400 });
  }
  const { agentId, paused } = parsed.data;

  try {
    const db = getAdminClient();
    const { error } = await db.from('agents').update({ paused }).eq('id', agentId);
    if (error) throw error;

    await db.from('logs').insert({
      level: 'info',
      message: `[${paused ? 'PAUSE' : 'RESUME'}] Agent ${agentId.slice(0, 8)} ${paused ? 'paused' : 'resumed'}`,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Pause failed' },
      { status: 500 }
    );
  }
}

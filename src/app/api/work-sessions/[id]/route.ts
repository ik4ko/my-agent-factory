import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminClient } from '@/lib/supabase/admin';
import type { WorkSessionRow } from '@/lib/types/database.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

const PatchSchema = z.object({
  /** Bump last_heartbeat_at — agents call this every ~60s while working. */
  heartbeat: z.boolean().optional(),
  /** Mark the session finished (sets finished_at). */
  finish: z.boolean().optional(),
  task_summary: z.string().trim().min(1).max(300).optional(),
  touched_files: z.array(z.string().trim().min(1).max(400)).max(100).optional(),
});

/** PATCH /api/work-sessions/[id] — heartbeat / update / finish. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' }, { status: 400 });
  }
  const { heartbeat, finish, ...fields } = parsed.data;

  const update: Record<string, unknown> = { ...fields };
  if (heartbeat) update.last_heartbeat_at = new Date().toISOString();
  if (finish) {
    update.status = 'finished';
    update.finished_at = new Date().toISOString();
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'empty patch' }, { status: 400 });
  }

  const { data, error } = await db().from('work_sessions').update(update).eq('id', id).select().maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'session not found' }, { status: 404 });
  return NextResponse.json({ session: data as WorkSessionRow });
}

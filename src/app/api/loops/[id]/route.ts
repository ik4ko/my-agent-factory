import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import type { LoopRow } from '@/lib/types/database.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

const PatchSchema = z.object({
  status: z.enum(['armed', 'paused', 'stopped']).optional(),
  cadence_seconds: z.number().int().min(5).max(86_400).nullable().optional(),
  objective: z.string().trim().min(1).max(4000).optional(),
});

/** PATCH /api/loops/[id] — arm/pause/stop a loop (and light field edits). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' }, { status: 400 });
  }
  const patch = parsed.data;

  const update: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
  // Arming schedules an immediate first tick; pausing/stopping clears it and
  // drops any lock so a currently-ticking run finishes but no new one starts.
  if (patch.status === 'armed') update.next_tick_at = new Date().toISOString();
  if (patch.status === 'paused' || patch.status === 'stopped') {
    update.next_tick_at = null;
    update.lock_owner = null;
    update.lock_at = null;
  }

  const { data, error } = await db().from('loops').update(update).eq('id', id).select().maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'loop not found' }, { status: 404 });

  const loop = data as LoopRow;
  if (patch.status) await hermesLog('info', `[LOOP] "${loop.name}" → ${patch.status}`);
  return NextResponse.json({ loop });
}

/** DELETE /api/loops/[id] — remove a loop (cascades loop_runs). */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data, error } = await db().from('loops').delete().eq('id', id).select('name').maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (data) await hermesLog('info', `[LOOP] deleted "${(data as { name: string }).name}"`);
  return NextResponse.json({ ok: true });
}

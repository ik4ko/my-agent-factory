import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminClient } from '@/lib/supabase/admin';
import type { WorkSessionRow } from '@/lib/types/database.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

/** GET /api/work-sessions — recent active sessions, newest heartbeat first.
 *  Auth: middleware (session cookie or MACHINE_API_TOKEN bearer). */
export async function GET() {
  const { data, error } = await db()
    .from('work_sessions')
    .select('*')
    .eq('status', 'active')
    .order('last_heartbeat_at', { ascending: false })
    .limit(10);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sessions: (data ?? []) as WorkSessionRow[] });
}

const StartSchema = z.object({
  agent_name: z.string().trim().min(1).max(80),
  task_summary: z.string().trim().min(1).max(300),
  touched_files: z.array(z.string().trim().min(1).max(400)).max(100).optional().default([]),
});

/** POST /api/work-sessions — start a session (agents call this with the
 *  machine token when they begin work). */
export async function POST(req: NextRequest) {
  const parsed = StartSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' }, { status: 400 });
  }
  const { data, error } = await db()
    .from('work_sessions')
    .insert({
      agent_name: parsed.data.agent_name,
      task_summary: parsed.data.task_summary,
      touched_files: parsed.data.touched_files,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ session: data as WorkSessionRow });
}

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminClient } from '@/lib/supabase/admin';

const Schema = z.object({
  name: z.string().min(1).max(64),
  role: z.enum(['generic', 'coder', 'researcher', 'browser', 'planner']),
});

export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'spawn requires a name and a valid role (generic|coder|researcher|browser|planner)' },
      { status: 400 }
    );
  }
  const { name, role } = parsed.data;

  try {
    const db = getAdminClient();
    const { data, error } = await db
      .from('agents')
      .insert({ name, type: role, status: 'idle', current_task_id: null })
      .select('id, name')
      .single();
    if (error) throw error;

    await db.from('logs').insert({
      level: 'success',
      message: `[SPAWN] Agent "${name}" (${role}) provisioned`,
    });

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Spawn failed' },
      { status: 500 }
    );
  }
}

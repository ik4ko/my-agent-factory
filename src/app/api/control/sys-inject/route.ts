import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminClient } from '@/lib/supabase/admin';

const Schema = z.object({ message: z.string().min(1).max(2000) });

// Broadcast a priority system-prompt injection into the active run. Modeled as
// a high-visibility log entry tagged in metadata so workers can pick it up.
export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 });
  }

  try {
    const db = getAdminClient();
    const { error } = await db.from('logs').insert({
      level: 'warn',
      message: `[SYS-INJECT] ${parsed.data.message}`,
      metadata: { kind: 'sys_inject', injected_at: new Date().toISOString() },
    });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Injection failed' },
      { status: 500 }
    );
  }
}

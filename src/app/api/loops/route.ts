import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import type { LoopRow } from '@/lib/types/database.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

/** GET /api/loops — list all loops, newest first. Auth-gated by middleware. */
export async function GET() {
  const { data, error } = await db().from('loops').select('*').order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ loops: (data ?? []) as LoopRow[] });
}

const TriggerSchema = z.object({
  type: z.enum(['news', 'price', 'earnings', 'manual']),
  symbol: z.string().max(10).optional(),
  minSeverity: z.enum(['low', 'med', 'high', 'critical']).optional(),
});

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(['trade', 'research', 'build', 'personal', 'monitor']),
  objective: z.string().trim().min(1).max(4000),
  cadence_seconds: z.number().int().min(5).max(86_400).nullable().optional(),
  triggers: z.array(TriggerSchema).optional().default([]),
  config: z.record(z.string(), z.unknown()).optional().default({}),
  brain: z.enum(['claude', 'codex', 'hermes']).optional().default('claude'),
  // New loops are created paused by default — the operator arms explicitly.
  status: z.enum(['armed', 'paused']).optional().default('paused'),
});

/** POST /api/loops — create a standing objective. Defaults to paused. */
export async function POST(req: NextRequest) {
  const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' }, { status: 400 });
  }
  const body = parsed.data;

  const { data, error } = await db()
    .from('loops')
    .insert({
      name: body.name,
      kind: body.kind,
      objective: body.objective,
      status: body.status,
      cadence_seconds: body.cadence_seconds ?? null,
      triggers: body.triggers,
      config: body.config,
      brain: body.brain,
      next_tick_at: body.status === 'armed' ? new Date().toISOString() : null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const loop = data as LoopRow;
  await hermesLog('info', `[LOOP] created "${loop.name}" (${loop.kind}, ${loop.status})`);
  return NextResponse.json({ loop });
}

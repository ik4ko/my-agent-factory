import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import type { LoopRow } from '@/lib/types/database.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

const PatchStrategySchema = z.object({
  status: z.enum(['armed', 'paused', 'stopped']).optional(),
  objective: z.string().trim().min(20).max(4000).optional(),
  cadence_seconds: z.number().int().min(30).max(86_400).nullable().optional(),
});

function isOperatorDirectLoop(loop: LoopRow): boolean {
  return (loop.config as { directOperator?: boolean } | null)?.directOperator === true;
}

async function readStrategy(id: string): Promise<LoopRow | null> {
  const { data, error } = await db().from('loops').select('*').eq('id', id).eq('kind', 'trade').maybeSingle();
  if (error) throw new Error(error.message);
  const loop = data as LoopRow | null;
  if (!loop || isOperatorDirectLoop(loop)) return null;
  return loop;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = PatchStrategySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid strategy patch' }, { status: 400 });
  }

  let existing: LoopRow | null;
  try {
    existing = await readStrategy(id);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'strategy read failed' }, { status: 500 });
  }
  if (!existing) return NextResponse.json({ error: 'strategy not found' }, { status: 404 });

  const patch = parsed.data;
  const update: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
  if (patch.status === 'armed') update.next_tick_at = new Date().toISOString();
  if (patch.status === 'paused' || patch.status === 'stopped') {
    update.next_tick_at = null;
    update.lock_owner = null;
    update.lock_at = null;
  }

  const { data, error } = await db().from('loops').update(update).eq('id', id).select().maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'strategy not found' }, { status: 404 });

  const strategy = data as LoopRow;
  if (patch.status) await hermesLog('info', `[TRADING] strategy "${strategy.name}" → ${patch.status}`);
  return NextResponse.json({ strategy });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let existing: LoopRow | null;
  try {
    existing = await readStrategy(id);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'strategy read failed' }, { status: 500 });
  }
  if (!existing) return NextResponse.json({ error: 'strategy not found' }, { status: 404 });

  const { error } = await db().from('loops').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await hermesLog('info', `[TRADING] strategy deleted "${existing.name}"`);
  return NextResponse.json({ ok: true });
}

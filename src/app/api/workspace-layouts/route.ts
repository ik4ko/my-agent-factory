import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminClient } from '@/lib/supabase/admin';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

const USER_KEY = 'operator';
const ROOMS = ['trading', 'coding', 'personal', 'hub'] as const;
const BREAKPOINTS = ['lg', 'md', 'sm'] as const;

const LayoutItemSchema = z
  .object({
    i: z.string().min(1).max(60),
    x: z.number().int().min(0).max(48),
    y: z.number().int().min(0).max(500),
    w: z.number().int().min(1).max(48),
    h: z.number().int().min(1).max(200),
  })
  // Preserve RGL extras (minW, static, …) without enumerating them.
  .passthrough();

const PutSchema = z.object({
  room: z.enum(ROOMS),
  breakpoint: z.enum(BREAKPOINTS),
  layout: z.array(LayoutItemSchema).max(40),
});

/** GET /api/workspace-layouts?room=trading → { layouts: { lg: [...], md: [...] } } */
export async function GET(req: NextRequest) {
  const room = req.nextUrl.searchParams.get('room');
  if (!room || !(ROOMS as readonly string[]).includes(room)) {
    return NextResponse.json({ error: 'unknown room' }, { status: 400 });
  }
  const { data, error } = await db()
    .from('workspace_layouts')
    .select('breakpoint, layout')
    .eq('user_key', USER_KEY)
    .eq('room', room);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const layouts: Record<string, unknown> = {};
  for (const row of data ?? []) layouts[row.breakpoint] = row.layout;
  return NextResponse.json({ layouts });
}

/** PUT /api/workspace-layouts — upsert one room+breakpoint layout. */
export async function PUT(req: NextRequest) {
  const parsed = PutSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' }, { status: 400 });
  }
  const { room, breakpoint, layout } = parsed.data;
  const { error } = await db()
    .from('workspace_layouts')
    .upsert(
      { user_key: USER_KEY, room, breakpoint, layout, updated_at: new Date().toISOString() },
      { onConflict: 'user_key,room,breakpoint' },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

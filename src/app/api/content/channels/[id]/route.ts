import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';

/**
 * PATCH /api/content/channels/:id — edit an EXISTING channel.
 *
 * label/niche/brand_voice were create-only until now, and `active` has existed
 * on the table since the first migration with no control surface at all. slug
 * is deliberately NOT editable: it is written into tasks.assigned_lane, so
 * changing it would orphan every historical run from its channel.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

const PatchSchema = z
  .object({
    label: z.string().min(1).max(60).optional(),
    niche: z.string().max(2000).optional(),
    brand_voice: z.string().max(4000).optional(),
    publish_targets: z.array(z.string().min(1).max(40)).max(10).optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
  }

  const { data, error } = await db()
    .from('content_channels')
    .update(parsed.data)
    .eq('id', id)
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Channel not found' }, { status: 404 });

  const changed = Object.keys(parsed.data).join(', ');
  await hermesLog('info', `[CONTENT] channel updated — ${data.label} (${changed})`);
  return NextResponse.json({ channel: data });
}

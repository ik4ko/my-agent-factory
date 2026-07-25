import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminClient } from '@/lib/supabase/admin';
import { listActiveChannels, slugifyChannelLabel } from '@/lib/content/channels';
import { hermesLog } from '@/lib/hermes/hermes-logger';

/**
 * Content channels CRUD — the "channels are data" seam.
 *
 * GET  → active channels, oldest first (the room's switcher order).
 * POST → insert a channel. This is the ONLY thing standing between the
 *        operator and a fourth/fifth vertical: no deploy, no code change, no
 *        brain-matrix entry. Auth-gated by middleware like every API route.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

const CreateSchema = z.object({
  label: z.string().min(1, 'Label is required').max(60),
  niche: z.string().max(2000).optional().default(''),
  brand_voice: z.string().max(4000).optional().default(''),
  publish_targets: z.array(z.string().min(1).max(40)).max(10).optional().default([]),
  /** Optional explicit slug; derived from the label when omitted. */
  slug: z.string().min(1).max(40).optional(),
});

export async function GET() {
  try {
    return NextResponse.json({ channels: await listActiveChannels() });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to load channels: ${String(err).slice(0, 200)}` },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const slug = (parsed.data.slug ?? slugifyChannelLabel(parsed.data.label)).trim();
  if (!slug) {
    return NextResponse.json(
      { error: 'Could not derive a slug from that label — use letters or numbers.' },
      { status: 400 },
    );
  }

  const { data, error } = await db()
    .from('content_channels')
    .insert({
      slug,
      label: parsed.data.label,
      niche: parsed.data.niche,
      brand_voice: parsed.data.brand_voice,
      publish_targets: parsed.data.publish_targets,
    })
    .select('*')
    .single();

  if (error) {
    // 23505 = unique_violation on slug — a human-meaningful conflict, not a 500.
    const conflict = String(error.code) === '23505';
    return NextResponse.json(
      { error: conflict ? `A channel with slug "${slug}" already exists.` : error.message },
      { status: conflict ? 409 : 500 },
    );
  }

  await hermesLog('success', `[CONTENT] channel created — ${parsed.data.label} (${slug})`);
  return NextResponse.json({ channel: data }, { status: 201 });
}

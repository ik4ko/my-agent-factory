import { getAdminClient } from '@/lib/supabase/admin';
import type { ChannelContext } from '@/lib/pipeline/types';
import type { ContentChannel } from '@/lib/types/database.types';

/**
 * Server-side access to content_channels.
 *
 * The engine calls `loadChannelContext` once per step to turn a channel id
 * into the runtime context injected into that stage's prompt. That injection
 * is the ENTIRE per-channel mechanism — there is no per-channel agent,
 * playbook, prompt file, or brain-matrix entry, which is what lets a new
 * vertical be a row rather than a deploy.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export function toChannelContext(row: ContentChannel): ChannelContext {
  return {
    slug: row.slug,
    label: row.label,
    niche: row.niche ?? '',
    brandVoice: row.brand_voice ?? '',
    // jsonb — tolerate a malformed value rather than breaking a run.
    publishTargets: Array.isArray(row.publish_targets) ? row.publish_targets : [],
  };
}

/** Null when the id is absent/unknown — callers degrade to an unscoped run
 *  rather than failing, so a deleted channel never strands a live pipeline. */
export async function loadChannelContext(channelId: string | undefined): Promise<ChannelContext | null> {
  if (!channelId) return null;
  try {
    const { data, error } = await db()
      .from('content_channels')
      .select('*')
      .eq('id', channelId)
      .maybeSingle();
    if (error || !data) return null;
    return toChannelContext(data as ContentChannel);
  } catch {
    return null;
  }
}

/** Active channels, oldest first — the room's switcher order. */
export async function listActiveChannels(): Promise<ContentChannel[]> {
  const { data, error } = await db()
    .from('content_channels')
    .select('*')
    .eq('active', true)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ContentChannel[];
}

/** Slugify a label into a stable machine key for a new channel. */
export function slugifyChannelLabel(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

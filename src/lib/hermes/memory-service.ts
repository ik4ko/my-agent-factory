import { getAdminClient } from '@/lib/supabase/admin';
import type { Memory } from '@/lib/types/database.types';

export interface MemoryWriteOptions {
  tags?: string[];
  importance?: number;
  source?: string;
  agentId?: string;
}

export async function readRecentMemory(limit = 5): Promise<Memory[]> {
  const db = getAdminClient();
  const { data } = await db
    .from('memory')
    .select('*')
    .order('importance', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as Memory[];
}

export async function searchMemory(query: string, limit = 8): Promise<Memory[]> {
  const db = getAdminClient();
  // Tag match first, then key contains, then value text search
  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);

  const { data } = await db
    .from('memory')
    .select('*')
    .or(keywords.map((k) => `key.ilike.%${k}%`).join(','))
    .order('importance', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(limit);

  return (data ?? []) as Memory[];
}

export async function writeMemory(
  key: string,
  value: Record<string, unknown>,
  opts: MemoryWriteOptions = {}
): Promise<void> {
  const { tags = [], importance = 5, source, agentId } = opts;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbw = getAdminClient() as any;

  const { data: existing } = await dbw
    .from('memory')
    .select('id, version')
    .eq('key', key)
    .maybeSingle();

  if (existing) {
    await dbw
      .from('memory')
      .update({
        value,
        version: existing.version + 1,
        tags,
        importance,
        source: source ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
  } else {
    await dbw.from('memory').insert({
      key,
      value,
      agent_id: agentId ?? null,
      version: 1,
      tags,
      importance,
      source: source ?? null,
    });
  }
}

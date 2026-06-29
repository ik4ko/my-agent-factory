import { getAdminClient } from '@/lib/supabase/admin';
import type { Memory } from '@/lib/types/database.types';

export async function readRecentMemory(limit = 5): Promise<Memory[]> {
  const db = getAdminClient();
  const { data } = await db
    .from('memory')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as Memory[];
}

export async function searchMemory(query: string, limit = 8): Promise<Memory[]> {
  const db = getAdminClient();
  const { data } = await db
    .from('memory')
    .select('*')
    .ilike('key', `%${query.trim()}%`)
    .order('updated_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as Memory[];
}

export async function writeMemory(
  key: string,
  value: Record<string, unknown>
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getAdminClient() as any;
  const { data: existing } = await db
    .from('memory')
    .select('id')
    .eq('key', key)
    .maybeSingle();

  if (existing) {
    await db
      .from('memory')
      .update({ value, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
  } else {
    await db.from('memory').insert({ key, value });
  }
}

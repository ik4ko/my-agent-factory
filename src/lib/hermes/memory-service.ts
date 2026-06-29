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

export async function writeMemory(
  key: string,
  value: Record<string, unknown>,
  agentId?: string
): Promise<void> {
  const db = getAdminClient();
  const { data: existing } = await db
    .from('memory')
    .select('id, version')
    .eq('key', key)
    .maybeSingle();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbw = db as any;

  if (existing) {
    const row = existing as Memory;
    await dbw
      .from('memory')
      .update({ value, version: row.version + 1, updated_at: new Date().toISOString() })
      .eq('id', row.id);
  } else {
    await dbw.from('memory').insert({ key, value, agent_id: agentId ?? null, version: 1 });
  }
}

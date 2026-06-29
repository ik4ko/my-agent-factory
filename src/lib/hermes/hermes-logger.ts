import { getAdminClient } from '@/lib/supabase/admin';
import type { LogLevel } from '@/lib/types/database.types';

export async function hermesLog(
  level: LogLevel,
  message: string,
  agentId?: string | null
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getAdminClient() as any;
    await db.from('logs').insert({
      level,
      message: `[HERMES] ${message}`,
      agent_id: agentId ?? null,
      timestamp: new Date().toISOString(),
    });
  } catch {
    // Logging must never crash the caller
  }
}

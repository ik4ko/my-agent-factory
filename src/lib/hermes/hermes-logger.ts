import { getAdminClient } from '@/lib/supabase/admin';
import type { LogLevel } from '@/lib/types/database.types';

export async function hermesLog(
  level: LogLevel,
  message: string,
  metadata: Record<string, unknown> = {},
  taskId?: string
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getAdminClient() as any;
  await db.from('logs').insert({
    level,
    message: `[HERMES] ${message}`,
    metadata,
    task_id: taskId ?? null,
    agent_id: null,
    timestamp: new Date().toISOString(),
  });
}

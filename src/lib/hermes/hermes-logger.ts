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

/**
 * Same persisted-log contract as hermesLog, but prefixed with the calling
 * brain's own identifier instead of a hardcoded [HERMES] — for matrix agents
 * (CODEX, GROK, ...) whose execution events should read as their own voice
 * in the Live Terminal, not the orchestrator's.
 */
export async function agentLog(level: LogLevel, brainId: string, message: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getAdminClient() as any;
    await db.from('logs').insert({
      level,
      message: `[${brainId}] ${message}`,
      agent_id: null,
      timestamp: new Date().toISOString(),
    });
  } catch {
    // Logging must never crash the caller
  }
}

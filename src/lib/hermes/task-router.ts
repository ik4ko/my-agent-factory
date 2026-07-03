import { getAdminClient } from '@/lib/supabase/admin';
import type { Agent, AgentType, Task } from '@/lib/types/database.types';

// Maps agent type to the expected agent name (seeded naming convention)
const AGENT_NAME_MAP: Partial<Record<AgentType, string>> = {
  coder:      'Codex',
  researcher: 'Scout',
  browser:    'Phantom',
  planner:    'Architect',
  generic:    'Hermes',
};

export async function findIdleAgent(type: AgentType): Promise<Agent | null> {
  const db = getAdminClient();
  const nameHint = AGENT_NAME_MAP[type];

  // Try to find the named agent first (exact type match by convention)
  if (nameHint) {
    const { data } = await db
      .from('agents')
      .select('*')
      .eq('status', 'idle')
      .ilike('name', nameHint)
      .limit(1)
      .maybeSingle();
    if (data) return data as Agent;
  }

  // Fall back to any idle agent
  const { data } = await db
    .from('agents')
    .select('*')
    .eq('status', 'idle')
    .limit(1)
    .maybeSingle();
  return (data ?? null) as Agent | null;
}

export async function createTask(description: string, agentId: string): Promise<Task> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getAdminClient() as any;
  const { data, error } = await db
    .from('tasks')
    .insert({ description, status: 'pending', agent_id: agentId })
    .select()
    .single();
  if (error || !data) throw new Error((error as Error)?.message ?? 'Failed to create task');
  return data as Task;
}

export async function assignAgentToTask(agentId: string, taskId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getAdminClient() as any;
  await Promise.all([
    db.from('agents').update({ status: 'busy', current_task_id: taskId }).eq('id', agentId),
    db.from('tasks').update({ status: 'running' }).eq('id', taskId),
  ]);
}

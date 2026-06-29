import { getAdminClient } from '@/lib/supabase/admin';
import type { Agent, AgentType, Task } from '@/lib/types/database.types';

export async function findIdleAgent(type: AgentType): Promise<Agent | null> {
  const db = getAdminClient();
  const { data } = await db
    .from('agents')
    .select('*')
    .eq('type', type)
    .eq('status', 'idle')
    .limit(1)
    .maybeSingle();
  return (data ?? null) as Agent | null;
}

export async function createTask(
  description: string,
  priority: number,
  agentId: string
): Promise<Task> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getAdminClient() as any;
  const { data, error } = await db
    .from('tasks')
    .insert({ description, priority, status: 'pending', agent_id: agentId, result: null })
    .select()
    .single();
  if (error || !data) throw new Error((error as Error)?.message ?? 'Failed to create task');
  return data as Task;
}

export async function assignAgentToTask(agentId: string, taskId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getAdminClient() as any;
  await Promise.all([
    db
      .from('agents')
      .update({ status: 'busy', current_task_id: taskId, last_heartbeat: new Date().toISOString() })
      .eq('id', agentId),
    db.from('tasks').update({ status: 'running' }).eq('id', taskId),
  ]);
}

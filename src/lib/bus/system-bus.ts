import { getAdminClient } from '@/lib/supabase/admin';

/**
 * system_bus — the federated room's event log (Phase 9, server-side only).
 *
 * Publish/consume primitives. The engine's pump (in pipeline/engine.ts, to
 * avoid a module cycle) consumes 'pipeline.step.completed' events and
 * triggers next steps; 'agent.thought' events are audit records of every
 * think() an agent performed, with provider/model/latency provenance.
 *
 * Durability property: hand-off payloads carry the FULL step output, so an
 * orphaned event (invocation died between publish and pump) is recoverable
 * by any later pump call — unlike in-process state.
 */

export type BusTopic =
  | 'pipeline.step.completed'
  | 'pipeline.completed'
  | 'agent.thought'
  /** Operator command delivered over Telegram. Audit + dedupe marker only —
   *  born 'consumed' so the pump (which reads pending 'pipeline.step.completed'
   *  rows) can never mistake it for hand-off work. */
  | 'operator.telegram.update';
export type BusStatus = 'pending' | 'consumed' | 'failed';

export interface BusEvent {
  id: string;
  topic: BusTopic;
  agent: string | null;
  pipeline_id: string | null;
  task_id: string | null;
  payload: Record<string, unknown>;
  status: BusStatus;
  created_at: string;
  consumed_at: string | null;
}

export interface PublishInput {
  topic: BusTopic;
  agent?: string | null;
  pipelineId?: string | null;
  taskId?: string | null;
  payload?: Record<string, unknown>;
  /** 'agent.thought' events are audit-only — born consumed. */
  status?: BusStatus;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export async function publishBusEvent(input: PublishInput): Promise<string | null> {
  const { data, error } = await db()
    .from('system_bus')
    .insert({
      topic: input.topic,
      agent: input.agent ?? null,
      pipeline_id: input.pipelineId ?? null,
      task_id: input.taskId ?? null,
      payload: input.payload ?? {},
      status: input.status ?? (input.topic === 'agent.thought' ? 'consumed' : 'pending'),
    })
    .select('id')
    .single();
  if (error) {
    console.warn(`[system_bus] publish failed: ${error.message}`);
    return null;
  }
  return (data as { id: string }).id;
}

/** Oldest-first pending hand-off events. */
export async function fetchPendingHandOffs(limit = 10): Promise<BusEvent[]> {
  const { data, error } = await db()
    .from('system_bus')
    .select('*')
    .eq('status', 'pending')
    .eq('topic', 'pipeline.step.completed')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message ?? 'system_bus read failed');
  return (data ?? []) as BusEvent[];
}

/**
 * Atomically claim a pending event (pending → consumed). Returns false if
 * another pump instance won the race — the compare-and-set predicate makes
 * double-processing impossible.
 */
export async function claimBusEvent(id: string): Promise<boolean> {
  const { data, error } = await db()
    .from('system_bus')
    .update({ status: 'consumed', consumed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message ?? 'system_bus claim failed');
  return Boolean(data);
}

export async function markBusEventFailed(id: string): Promise<void> {
  await db().from('system_bus').update({ status: 'failed' }).eq('id', id);
}

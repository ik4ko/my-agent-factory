// Typed client-side helpers for Phase C control actions. Each posts to a
// guarded server route (service-role) and returns a typed result. Throwing on
// failure lets callers surface errors in the console/log viewer.
import type { AgentType, EmergencyStopResult } from '@/lib/types/database.types';

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
  return json;
}

export type InterventionDecision = 'approve' | 'deny';

export function emergencyStop(): Promise<EmergencyStopResult> {
  return post<EmergencyStopResult>('/api/control/emergency-stop', {});
}

export function decideIntervention(
  taskId: string,
  decision: InterventionDecision,
  feedback?: string
): Promise<{ ok: true }> {
  return post('/api/control/task-intervention', { taskId, decision, feedback });
}

export function sysInject(message: string): Promise<{ ok: true }> {
  return post('/api/control/sys-inject', { message });
}

export function spawnAgent(name: string, role: AgentType): Promise<{ id: string; name: string }> {
  return post('/api/agents/spawn', { name, role });
}

export function pauseAgent(agentId: string, paused: boolean): Promise<{ ok: true }> {
  return post('/api/agents/pause', { agentId, paused });
}

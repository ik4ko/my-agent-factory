import { createHash } from 'node:crypto';
import { getAdminClient } from '@/lib/supabase/admin';

export function hashActionPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export type ActionClaim =
  | { claimed: true }
  | { claimed: false; status: 'claimed' | 'completed' | 'failed'; response: unknown };

/** Atomically claims a durable action key. A crash leaves the key claimed,
 * deliberately failing closed instead of replaying an ambiguous side effect. */
export async function claimAction(scope: string, key: string, payload: unknown): Promise<ActionClaim> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getAdminClient() as any;
  const requestHash = hashActionPayload(payload);
  const { error } = await db.from('action_claims').insert({
    scope,
    idempotency_key: key,
    request_hash: requestHash,
    status: 'claimed',
  });
  if (!error) return { claimed: true };
  if (error.code !== '23505') throw new Error(`idempotency claim failed: ${error.message}`);

  const { data, error: readError } = await db
    .from('action_claims')
    .select('request_hash, status, response')
    .eq('scope', scope)
    .eq('idempotency_key', key)
    .single();
  if (readError || !data) throw new Error(`idempotency replay lookup failed: ${readError?.message ?? 'missing claim'}`);
  if (data.request_hash !== requestHash) throw new Error('idempotency key was already used for a different request');
  return { claimed: false, status: data.status, response: data.response };
}

export async function finishAction(scope: string, key: string, response: unknown, failed = false): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getAdminClient() as any;
  const { error } = await db.from('action_claims').update({
    status: failed ? 'failed' : 'completed',
    response,
    completed_at: new Date().toISOString(),
  }).eq('scope', scope).eq('idempotency_key', key).eq('status', 'claimed');
  if (error) throw new Error(`idempotency completion failed: ${error.message}`);
}


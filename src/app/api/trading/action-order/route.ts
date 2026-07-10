import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';

/**
 * PATCH /api/trading/action-order — record the HUMAN decision on a staged order.
 *
 * Flips human_approval_status PENDING → APPROVED | DENIED, exactly once
 * (already-decided rows are immutable; the update is guarded by a
 * status='PENDING' predicate so double-clicks and races can't re-decide).
 *
 * IMPORTANT: approval records a decision — nothing more. No brokerage
 * dispatch exists in this codebase, and if/when one is mounted here it must
 * remain triggered by this human-initiated request, never by an agent.
 *
 * `dedupeKey` (optional): an at-least-once delivery id — today the Telegram
 * update_id from the operator watcher. When present, the decision is CLAIMED
 * in system_bus *before* the order is touched; the claim's unique index makes
 * a redelivered command fail closed (409 deduped) instead of re-entering the
 * action path. The dashboard omits it and behaves exactly as before.
 */

const ActionSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(['APPROVED', 'DENIED']),
  dedupeKey: z.string().min(1).max(64).optional(),
  source: z.string().max(32).optional(),
});

export async function PATCH(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = ActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { id, action, dedupeKey, source } = parsed.data;
  const db = getAdminClient();

  // ── Dedupe claim — strictly BEFORE any state change ──
  // Unique partial index on (payload->>'update_id') where
  // topic='operator.telegram.update' makes this an atomic claim: the first
  // delivery wins, a redelivery raises 23505 and never reaches the update.
  if (dedupeKey) {
    const { error: claimError } = await db.from('system_bus').insert({
      topic: 'operator.telegram.update',
      agent: source ?? 'telegram-watcher',
      pipeline_id: null,
      task_id: null,
      payload: { update_id: dedupeKey, action, order_id: id, source: source ?? 'telegram' },
      status: 'consumed', // audit marker, never hand-off work for the pump
      consumed_at: new Date().toISOString(),
    });
    if (claimError) {
      if (claimError.code === '23505') {
        return NextResponse.json(
          { error: 'Duplicate delivery — this command was already processed', deduped: true },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: `dedupe claim failed: ${claimError.message}` }, { status: 500 });
    }
  }

  const { data, error } = await db
    .from('staged_orders')
    .update({ human_approval_status: action })
    .eq('id', id)
    .eq('human_approval_status', 'PENDING') // once-only: decided rows are immutable
    .select()
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { error: 'Order not found or already decided' },
      { status: 409 },
    );
  }

  await hermesLog(
    action === 'APPROVED' ? 'success' : 'warn',
    `Human decision recorded: staged order ${data.underlying} ${data.option_type} ${data.strike} → ${action}`,
  );

  return NextResponse.json({ order: data });
}

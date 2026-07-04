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
 */

const ActionSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(['APPROVED', 'DENIED']),
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

  const { id, action } = parsed.data;
  const db = getAdminClient();

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

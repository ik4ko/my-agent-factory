import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireMedicareOperator } from '@/lib/medicare-crm/auth';
import { db, isMissingTable, maskMbiValue, recordAudit } from '@/lib/medicare-crm/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One client, with everything needed to decide what to do about them:
 * identity, policies, provenance of each data point, pending coverage
 * proposals, open tasks, communications, and the audit trail.
 *
 * The MBI is masked on the way out, exactly as the room's list endpoint
 * already does. There is no query parameter to unmask it — the browser has no
 * legitimate need for a raw MBI, and the extension lane that does need one
 * (Phase 4) is a separate bearer-token route that never serves this shape.
 */

/** Optional table: absent means the migration has not run, not a failure. */
function optional<T>(result: { data: T[] | null; error: unknown }): T[] {
  const error = result.error as { message?: string; code?: string } | null;
  if (error) {
    if (isMissingTable(error)) return [];
    throw new Error(error.message ?? 'query failed');
  }
  return result.data ?? [];
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authError = await requireMedicareOperator(request);
  if (authError) return authError;

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid client id' }, { status: 400 });
  }

  try {
    const { data: client, error: clientError } = await db()
      .from('ag_clients')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (clientError) return NextResponse.json({ error: clientError.message }, { status: 500 });
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

    const [policies, notes, communications, snapshots, diffs, tasks, audit, leads] = await Promise.all([
      db().from('ag_policies').select('*').eq('client_id', id).order('effective_date', { ascending: false }),
      db().from('ag_client_notes').select('*').eq('client_id', id).order('created_at', { ascending: false }).limit(100),
      db()
        .from('ag_communications_log')
        .select('*')
        .eq('client_id', id)
        .order('timestamp', { ascending: false })
        .limit(100),
      db()
        .from('ag_coverage_snapshots')
        .select('id, source, source_detail, observed_at, verification_status, contract_pbp, plan_name, carrier_name, effective_date, end_date, plan_status, evidence_ref, created_at')
        .eq('client_id', id)
        .order('observed_at', { ascending: false })
        .limit(50),
      db()
        .from('ag_coverage_diffs')
        .select('*')
        .eq('client_id', id)
        .order('created_at', { ascending: false })
        .limit(50),
      db()
        .from('ag_operator_tasks')
        .select('*')
        .eq('client_id', id)
        .in('status', ['open', 'snoozed'])
        .order('created_at', { ascending: false })
        .limit(50),
      db()
        .from('ag_audit_events')
        .select('id, actor, action, entity_type, entity_id, before, after, detail, created_at')
        .eq('entity_id', id)
        .order('created_at', { ascending: false })
        .limit(50),
      // The lead this client was converted from, if any — it carries the
      // consent record, which is the thing that decides whether Eric may text
      // them. That belongs on the client page, not buried in the lead inbox.
      db()
        .from('ag_website_leads')
        .select('id, source_page, attribution, consent_reply, consent_sms, consent_marketing, submitted_at, converted_at')
        .eq('converted_client_id', id)
        .limit(5),
    ]);

    return NextResponse.json({
      client: {
        ...client,
        medicare_beneficiary_identifier: null,
        masked_mbi: maskMbiValue(client.medicare_beneficiary_identifier),
      },
      policies: optional(policies),
      notes: optional(notes),
      communications: optional(communications),
      snapshots: optional(snapshots),
      diffs: optional(diffs),
      tasks: optional(tasks),
      audit: optional(audit),
      originLeads: optional(leads),
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Client detail unavailable: ${String(error).slice(0, 180)}` },
      { status: 500 },
    );
  }
}

/**
 * Operator edits to review scheduling.
 *
 * Deliberately narrow. This does not accept coverage fields — those only ever
 * change through the coverage-review accept path, so that every change to a
 * plan carries a snapshot and an audit record explaining where it came from.
 */
const patchSchema = z.object({
  next_review_at: z.string().datetime().nullable().optional(),
  mark_verified: z.boolean().optional(),
});

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authError = await requireMedicareOperator(request);
  if (authError) return authError;

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid client id' }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const update: Record<string, unknown> = { updated_at: now };

  if (parsed.data.next_review_at !== undefined) update.next_review_at = parsed.data.next_review_at;
  if (parsed.data.mark_verified) update.last_verified_at = now;

  if (Object.keys(update).length === 1) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const { data: before } = await db()
    .from('ag_clients')
    .select('next_review_at, last_verified_at')
    .eq('id', id)
    .maybeSingle();

  const { error } = await db().from('ag_clients').update(update).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordAudit({
    action: 'client_review_updated',
    entityType: 'ag_clients',
    entityId: id,
    before: before ?? {},
    after: update,
  });

  return NextResponse.json({ ok: true, id });
}

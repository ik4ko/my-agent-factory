import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireMedicareOperator } from '@/lib/medicare-crm/auth';
import { db, isMissingTable, recordAudit } from '@/lib/medicare-crm/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Coverage review — the approval gate between an observation and the book of
 * business.
 *
 * GET  lists pending proposals with enough context to decide.
 * POST resolves one: accept, reject, or flag for follow-up.
 *
 * Accepting a diff is the ONLY code path in this application that writes a
 * verified coverage value onto ag_policies or ag_clients. Imports, the
 * extension lane, and any future automation all stop at ag_coverage_snapshots
 * and propose; a human presses accept, and that press is audited with the
 * before and after values.
 */

/**
 * Fields a diff is permitted to overwrite.
 *
 * An allowlist rather than a denylist, because target_field reaches the update
 * as a column name. Without this, a malformed or malicious diff row could name
 * any column in the table — including one that grants access or rewrites an
 * identifier — and the accept path would dutifully write it.
 *
 * medicare_beneficiary_identifier and date_of_birth are deliberately absent.
 * They are the two fields that decide *who a record is about*, and a scraped
 * source correcting them is a claim that the record has been misidentified —
 * which is an identity-resolution decision, not a field update. Those stay
 * manual, in the CRM edit flow, after Eric has actually confirmed identity.
 */
const APPLICABLE_FIELDS: Record<'ag_policies' | 'ag_clients', ReadonlySet<string>> = {
  ag_policies: new Set([
    'contract_pbp',
    'plan_name',
    'plan_id',
    'effective_date',
    'status',
    'monthly_premium',
    'commission_level',
  ]),
  ag_clients: new Set(['phone', 'email', 'physical_address', 'city', 'state', 'zip']),
};

/** Columns stored as dates; empty string must become null, not ''. */
const DATE_FIELDS = new Set(['effective_date']);
const NUMERIC_FIELDS = new Set(['monthly_premium']);

function coerceForColumn(field: string, value: string | null): string | number | null {
  if (value === null || value.trim() === '') return null;
  if (NUMERIC_FIELDS.has(field)) {
    const numeric = Number(value.replace(/[$,]/g, ''));
    return Number.isFinite(numeric) ? numeric : null;
  }
  if (DATE_FIELDS.has(field)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  return value;
}

export async function GET(request: NextRequest) {
  const authError = await requireMedicareOperator(request);
  if (authError) return authError;

  const statusFilter = request.nextUrl.searchParams.get('status') ?? 'pending';
  const clientId = request.nextUrl.searchParams.get('clientId');

  try {
    let query = db()
      .from('ag_coverage_diffs')
      .select(
        'id, client_id, policy_id, snapshot_id, target_table, target_field, current_value, incoming_value, source, observed_at, confidence, status, resolved_at, resolved_by, resolution_note, created_at',
      )
      .order('observed_at', { ascending: true })
      .limit(300);

    if (statusFilter !== 'all') query = query.eq('status', statusFilter);
    if (clientId) query = query.eq('client_id', clientId);

    const diffs = await query;

    if (diffs.error) {
      if (isMissingTable(diffs.error)) {
        return NextResponse.json({
          diffs: [],
          clients: [],
          snapshots: [],
          migrationApplied: false,
          note: 'ag_coverage_diffs does not exist yet. Apply 20260728_medicare_cockpit.sql.',
        });
      }
      return NextResponse.json({ error: diffs.error.message }, { status: 500 });
    }

    const rows = diffs.data ?? [];
    const clientIds = [...new Set(rows.map((row: { client_id: string }) => row.client_id))];
    const snapshotIds = [...new Set(rows.map((row: { snapshot_id: string }) => row.snapshot_id))];

    // Only fetch context when there is something to contextualise — an `.in()`
    // with an empty array is a wasted round trip on the common empty queue.
    const [clients, snapshots] = await Promise.all([
      clientIds.length
        ? db().from('ag_clients').select('id, first_name, last_name, city, state').in('id', clientIds)
        : Promise.resolve({ data: [], error: null }),
      snapshotIds.length
        ? db()
            .from('ag_coverage_snapshots')
            .select('id, source, source_detail, observed_at, verification_status, contract_pbp, plan_name, carrier_name, evidence_ref')
            .in('id', snapshotIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    return NextResponse.json({
      diffs: rows,
      clients: clients.data ?? [],
      snapshots: snapshots.data ?? [],
      migrationApplied: true,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Coverage review unavailable: ${String(error).slice(0, 180)}` },
      { status: 500 },
    );
  }
}

const resolveSchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(['accept', 'reject', 'follow_up']),
  note: z.string().max(2000).optional(),
});

export async function POST(request: NextRequest) {
  const authError = await requireMedicareOperator(request);
  if (authError) return authError;

  const parsed = resolveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const { id, decision, note } = parsed.data;
  const now = new Date().toISOString();

  const { data: diff, error: diffError } = await db()
    .from('ag_coverage_diffs')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (diffError || !diff) {
    return NextResponse.json({ error: 'Diff not found' }, { status: 404 });
  }

  // Resolving twice is a no-op rather than a second write. Two operators (or
  // one impatient double-click) must not apply the same change twice.
  if (diff.status !== 'pending') {
    return NextResponse.json(
      { error: 'Already resolved', status: diff.status },
      { status: 409 },
    );
  }

  // ── Reject / follow-up: no data is written to the book of business ────────
  if (decision !== 'accept') {
    const nextStatus = decision === 'reject' ? 'rejected' : 'follow_up';
    await db()
      .from('ag_coverage_diffs')
      .update({
        status: nextStatus,
        resolved_at: now,
        resolved_by: 'operator',
        resolution_note: note ?? '',
        updated_at: now,
      })
      .eq('id', id);

    await recordAudit({
      action: `coverage_diff_${nextStatus}`,
      entityType: 'ag_coverage_diffs',
      entityId: id,
      before: { status: 'pending' },
      after: { status: nextStatus },
      detail: {
        clientId: diff.client_id,
        field: `${diff.target_table}.${diff.target_field}`,
        proposedValue: diff.incoming_value,
        note: note ?? '',
      },
    });

    return NextResponse.json({ ok: true, id, status: nextStatus, applied: false });
  }

  // ── Accept: the one path that mutates client or policy data ───────────────
  const targetTable = diff.target_table as 'ag_policies' | 'ag_clients';
  const allowed = APPLICABLE_FIELDS[targetTable];
  if (!allowed || !allowed.has(diff.target_field)) {
    return NextResponse.json(
      {
        error: `Field ${diff.target_table}.${diff.target_field} cannot be applied automatically. Update it manually after confirming identity.`,
      },
      { status: 422 },
    );
  }

  const targetId = targetTable === 'ag_policies' ? diff.policy_id : diff.client_id;
  if (!targetId) {
    return NextResponse.json(
      { error: 'This diff has no target record to apply to.' },
      { status: 422 },
    );
  }

  // Re-read the live value immediately before writing. The diff's stored
  // current_value was captured when the observation arrived, which may be
  // weeks ago — if someone edited the record since, applying blindly would
  // silently clobber that edit.
  const { data: liveRow, error: liveError } = await db()
    .from(targetTable)
    .select(`id, ${diff.target_field}`)
    .eq('id', targetId)
    .maybeSingle();

  if (liveError || !liveRow) {
    return NextResponse.json({ error: 'Target record no longer exists' }, { status: 404 });
  }

  const liveValue = liveRow[diff.target_field];
  const liveAsText = liveValue === null || liveValue === undefined ? null : String(liveValue);

  if (liveAsText !== (diff.current_value ?? null)) {
    await db()
      .from('ag_coverage_diffs')
      .update({
        status: 'superseded',
        resolved_at: now,
        resolved_by: 'operator',
        resolution_note: `Record changed since this was proposed (now: ${liveAsText ?? 'empty'}). Re-verify before applying.`,
        updated_at: now,
      })
      .eq('id', id);

    await recordAudit({
      action: 'coverage_diff_superseded',
      entityType: 'ag_coverage_diffs',
      entityId: id,
      before: { expected: diff.current_value },
      after: { actual: liveAsText },
      detail: { clientId: diff.client_id, field: `${diff.target_table}.${diff.target_field}` },
    });

    return NextResponse.json(
      {
        error: 'The record changed since this change was proposed. It has been marked superseded — re-verify before applying.',
        status: 'superseded',
      },
      { status: 409 },
    );
  }

  const nextValue = coerceForColumn(diff.target_field, diff.incoming_value);

  const { error: applyError } = await db()
    .from(targetTable)
    .update({
      [diff.target_field]: nextValue,
      last_verified_at: diff.observed_at,
      updated_at: now,
    })
    .eq('id', targetId);

  if (applyError) {
    return NextResponse.json({ error: applyError.message }, { status: 500 });
  }

  // A policy verification also confirms the client was reachable at the source.
  if (targetTable === 'ag_policies') {
    await db()
      .from('ag_clients')
      .update({ last_verified_at: diff.observed_at, updated_at: now })
      .eq('id', diff.client_id);
  }

  await db()
    .from('ag_coverage_diffs')
    .update({
      status: 'accepted',
      resolved_at: now,
      resolved_by: 'operator',
      resolution_note: note ?? '',
      updated_at: now,
    })
    .eq('id', id);

  await recordAudit({
    action: 'coverage_diff_accepted',
    entityType: targetTable,
    entityId: targetId,
    before: { [diff.target_field]: diff.current_value },
    after: { [diff.target_field]: diff.incoming_value },
    detail: {
      diffId: id,
      clientId: diff.client_id,
      snapshotId: diff.snapshot_id,
      source: diff.source,
      observedAt: diff.observed_at,
      note: note ?? '',
    },
  });

  // Close any operator task that existed only to prompt this decision.
  await db()
    .from('ag_operator_tasks')
    .update({ status: 'done', completed_at: now, completed_by: 'operator', updated_at: now })
    .eq('diff_id', id)
    .eq('status', 'open');

  return NextResponse.json({ ok: true, id, status: 'accepted', applied: true });
}

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireMedicareOperator } from '@/lib/medicare-crm/auth';
import { db, recordAudit } from '@/lib/medicare-crm/db';
import { diffIdempotencyKey, snapshotIdempotencyKey } from '@/lib/medicare-crm/coverage';
import { taskDedupeKey } from '@/lib/medicare-crm/coverage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One import batch: inspect, commit, or reject.
 *
 * What committing does, and just as importantly what it does not:
 *
 *   create     inserts a NEW ag_clients row. Adding someone who was not in
 *              the book is not an overwrite, and it is what the operator just
 *              confirmed.
 *   change     writes a coverage SNAPSHOT and proposes DIFFS. It does not
 *              touch the existing record. Eric approves each change in
 *              Coverage Reviews, exactly as with a verification result.
 *   unchanged  writes a snapshot only — evidence the record was confirmed.
 *   ambiguous  writes nothing and raises a task. Identity resolution is his.
 *   duplicate  writes nothing.
 *   rejected   writes nothing.
 *
 * So an uploaded file can add people and can propose changes, but it can never
 * silently alter someone already in the book.
 */

const FIELD_TARGETS: { field: string; table: 'ag_clients'; confidence: 'low' | 'medium' | 'high' }[] = [
  { field: 'phone', table: 'ag_clients', confidence: 'medium' },
  { field: 'email', table: 'ag_clients', confidence: 'medium' },
  { field: 'physical_address', table: 'ag_clients', confidence: 'low' },
  { field: 'city', table: 'ag_clients', confidence: 'low' },
  { field: 'state', table: 'ag_clients', confidence: 'medium' },
  { field: 'zip', table: 'ag_clients', confidence: 'medium' },
];

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authError = await requireMedicareOperator(request);
  if (authError) return authError;

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid batch id' }, { status: 400 });
  }

  const [batch, records] = await Promise.all([
    db().from('ag_import_batches').select('*').eq('id', id).maybeSingle(),
    db()
      .from('ag_import_records')
      .select('id, row_number, normalized, disposition, matched_client_id, match_confidence, match_candidates, issues')
      .eq('batch_id', id)
      .order('row_number', { ascending: true })
      .limit(500),
  ]);

  if (batch.error || !batch.data) {
    return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
  }

  return NextResponse.json({ batch: batch.data, records: records.data ?? [] });
}

const actionSchema = z.object({
  action: z.enum(['commit', 'reject']),
  note: z.string().max(2000).optional(),
});

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authError = await requireMedicareOperator(request);
  if (authError) return authError;

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid batch id' }, { status: 400 });
  }

  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const { data: batch, error: batchError } = await db()
    .from('ag_import_batches')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (batchError || !batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 });

  // Committing twice would duplicate every created client. The snapshot and
  // diff idempotency keys would absorb the proposals, but nothing would stop
  // a second round of inserts, so the batch status is the guard.
  if (batch.status !== 'previewed') {
    return NextResponse.json(
      { error: `This batch is ${batch.status} and cannot be actioned again.`, status: batch.status },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();

  if (parsed.data.action === 'reject') {
    await db()
      .from('ag_import_batches')
      .update({ status: 'rejected', error: parsed.data.note ?? null, updated_at: now })
      .eq('id', id);

    await recordAudit({
      action: 'import_batch_rejected',
      entityType: 'ag_import_batches',
      entityId: id,
      detail: { note: parsed.data.note ?? '' },
    });

    return NextResponse.json({ ok: true, status: 'rejected', applied: false });
  }

  // ── Commit ───────────────────────────────────────────────────────────────
  const { data: records, error: recordsError } = await db()
    .from('ag_import_records')
    .select('id, row_number, normalized, disposition, matched_client_id')
    .eq('batch_id', id)
    .limit(10_000);

  if (recordsError) return NextResponse.json({ error: recordsError.message }, { status: 500 });

  const result = { created: 0, snapshots: 0, diffs: 0, tasks: 0, skipped: 0 };
  const observedAt = batch.created_at ?? now;

  for (const record of records ?? []) {
    const row = (record.normalized ?? {}) as Record<string, string | number | null>;

    if (record.disposition === 'create') {
      const { data: created, error } = await db()
        .from('ag_clients')
        .insert({
          first_name: row.first_name ?? 'Unknown',
          last_name: row.last_name ?? '',
          phone: row.phone ?? null,
          email: row.email ?? null,
          date_of_birth: row.date_of_birth ?? null,
          physical_address: row.physical_address ?? null,
          city: row.city ?? null,
          state: row.state ?? null,
          zip: row.zip ?? null,
          medicare_beneficiary_identifier: row.medicare_beneficiary_identifier ?? null,
          tags: ['imported'],
        })
        .select('id')
        .single();

      if (error) {
        result.skipped += 1;
        continue;
      }
      result.created += 1;
      await db().from('ag_import_records').update({ matched_client_id: created.id }).eq('id', record.id);
      continue;
    }

    if (record.disposition === 'ambiguous') {
      // A human decides who this row is about. Never guessed.
      const { error } = await db().from('ag_operator_tasks').insert({
        kind: 'ambiguous_match',
        title: `Ambiguous import match — ${row.last_name ?? 'unknown'}, row ${record.row_number}`,
        detail: `Row ${record.row_number} of this import matched more than one client, or matched on name alone. Resolve the identity before the row can be applied.`,
        priority: 'high',
        source: 'import',
        dedupe_key: taskDedupeKey({ kind: 'ambiguous_match', anchorId: `${id}:${record.row_number}` }),
      });
      // A unique-violation means the task already exists; that is the dedupe
      // guarantee working, not a failure.
      if (!error) result.tasks += 1;
      continue;
    }

    if (record.disposition !== 'change' && record.disposition !== 'unchanged') {
      result.skipped += 1;
      continue;
    }

    const clientId = record.matched_client_id as string | null;
    if (!clientId) {
      result.skipped += 1;
      continue;
    }

    const { data: snapshot, error: snapshotError } = await db()
      .from('ag_coverage_snapshots')
      .insert({
        client_id: clientId,
        source: 'import',
        source_detail: `${batch.original_filename ?? 'upload'} (batch ${String(id).slice(0, 8)})`,
        observed_at: observedAt,
        contract_pbp: row.contract_pbp ?? null,
        plan_name: row.plan_name ?? null,
        carrier_name: row.carrier_name ?? null,
        effective_date: row.effective_date ?? null,
        end_date: row.end_date ?? null,
        verification_status: record.disposition === 'change' ? 'active_changed' : 'active_same',
        raw: row,
        idempotency_key: snapshotIdempotencyKey({
          source: 'import',
          clientId,
          observedAt,
          verificationStatus: record.disposition === 'change' ? 'active_changed' : 'active_same',
        }),
      })
      .select('id')
      .single();

    // A duplicate key here means this observation is already recorded — the
    // point of the idempotency key. Move on rather than failing the batch.
    if (snapshotError || !snapshot) {
      result.skipped += 1;
      continue;
    }
    result.snapshots += 1;
    await db().from('ag_import_records').update({ snapshot_id: snapshot.id }).eq('id', record.id);

    if (record.disposition !== 'change') continue;

    const { data: current } = await db()
      .from('ag_clients')
      .select('phone, email, physical_address, city, state, zip')
      .eq('id', clientId)
      .maybeSingle();

    for (const target of FIELD_TARGETS) {
      const incoming = row[target.field];
      if (incoming === null || incoming === undefined || incoming === '') continue;
      const existing = (current ?? {})[target.field] ?? null;
      if (String(existing ?? '') === String(incoming)) continue;

      const { error } = await db().from('ag_coverage_diffs').insert({
        client_id: clientId,
        snapshot_id: snapshot.id,
        target_table: target.table,
        target_field: target.field,
        current_value: existing === null ? null : String(existing),
        incoming_value: String(incoming),
        source: 'import',
        observed_at: observedAt,
        confidence: target.confidence,
        idempotency_key: diffIdempotencyKey({
          source: 'import',
          clientId,
          targetTable: target.table,
          targetField: target.field,
          incomingValue: String(incoming),
        }),
      });
      if (!error) result.diffs += 1;
    }
  }

  await db()
    .from('ag_import_batches')
    .update({ status: 'committed', committed_at: now, updated_at: now })
    .eq('id', id);

  await recordAudit({
    action: 'import_batch_committed',
    entityType: 'ag_import_batches',
    entityId: id,
    detail: { ...result, filename: batch.original_filename, sha256: batch.file_sha256 },
  });

  return NextResponse.json({
    ok: true,
    status: 'committed',
    ...result,
    // Stated plainly so no caller mistakes a commit for an applied change.
    note: 'Proposed changes to existing clients are awaiting approval in Coverage Reviews. Nothing was overwritten.',
  });
}

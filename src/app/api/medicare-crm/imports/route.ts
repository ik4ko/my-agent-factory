import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { requireMedicareOperator } from '@/lib/medicare-crm/auth';
import { db, isMissingTable, recordAudit } from '@/lib/medicare-crm/db';
import {
  IMPORT_FIELDS,
  MAX_FILE_BYTES,
  matchClient,
  normalizeRow,
  parseCsv,
  rowDedupeKey,
  suggestMapping,
  type ClientCandidate,
  type ImportEntity,
  type NormalizedRow,
} from '@/lib/medicare-crm/import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Staged import — upload and preview.
 *
 * GET   lists batches.
 * POST  accepts a CSV, stages it, and returns a preview. It writes NOTHING to
 *       ag_clients or ag_policies. Committing is a separate, explicit call on
 *       the batch (see ./[id]/route.ts).
 *
 * The file is parsed SERVER-SIDE, behind the operator gate. The retired import
 * parsed a workbook in the browser with xlsx@0.18.5 — a package carrying
 * unpatched prototype-pollution and ReDoS advisories — which also meant member
 * PII was loaded into the page before anything had authorised it. CSV only for
 * now; XLSX needs a parser security review before it comes back.
 */

const MAX_CANDIDATES = 5_000;

export async function GET(request: NextRequest) {
  const authError = await requireMedicareOperator(request);
  if (authError) return authError;

  const batches = await db()
    .from('ag_import_batches')
    .select('id, source_kind, source_label, original_filename, row_count, entity, status, created_count, matched_count, changed_count, rejected_count, duplicate_count, error, created_at, committed_at, rolled_back_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (batches.error) {
    if (isMissingTable(batches.error)) {
      return NextResponse.json({
        batches: [],
        migrationApplied: false,
        note: 'ag_import_batches does not exist yet. Apply 20260729_import_batches.sql.',
      });
    }
    return NextResponse.json({ error: batches.error.message }, { status: 500 });
  }

  return NextResponse.json({ batches: batches.data ?? [], migrationApplied: true });
}

const ENTITIES: ImportEntity[] = ['clients', 'policies', 'coverage'];

export async function POST(request: NextRequest) {
  const authError = await requireMedicareOperator(request);
  if (authError) return authError;

  // Reject on the declared size before reading the body. Streaming a
  // 500MB upload into memory and *then* measuring it is the bug this avoids.
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `File is larger than ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)}MB.` },
      { status: 413 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected a multipart form upload.' }, { status: 400 });
  }

  const file = form.get('file');
  const entityRaw = String(form.get('entity') ?? 'clients');
  const sourceLabel = String(form.get('sourceLabel') ?? '').slice(0, 200);

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file was uploaded.' }, { status: 400 });
  }
  if (!ENTITIES.includes(entityRaw as ImportEntity)) {
    return NextResponse.json({ error: 'Unknown import entity.' }, { status: 400 });
  }
  const entity = entityRaw as ImportEntity;

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `File is larger than ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)}MB.` },
      { status: 413 },
    );
  }
  // Extension is a hint, not a guarantee — parseCsv re-checks the content.
  if (!/\.csv$/i.test(file.name)) {
    return NextResponse.json(
      { error: 'Only .csv files are accepted. Export your spreadsheet as CSV first.' },
      { status: 415 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  // UTF-8 with a replacement-character guard: a Latin-1 export decoded as
  // UTF-8 turns accented names into garbage, and silently importing "Jos�"
  // as someone's legal name is worse than refusing the file.
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if ((text.match(/�/g)?.length ?? 0) > 0) {
    return NextResponse.json(
      { error: 'The file is not valid UTF-8. Re-export it with UTF-8 encoding.' },
      { status: 400 },
    );
  }

  const parsed = parseCsv(text);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  // An operator-supplied mapping overrides the suggestion.
  let mapping = suggestMapping(parsed.headers, entity);
  const mappingRaw = form.get('mapping');
  if (typeof mappingRaw === 'string' && mappingRaw.trim()) {
    try {
      const supplied = JSON.parse(mappingRaw) as Record<string, string>;
      const allowed = new Set(IMPORT_FIELDS[entity]);
      mapping = Object.fromEntries(
        Object.entries(supplied).filter(
          ([field, header]) => allowed.has(field) && parsed.headers.includes(header),
        ),
      );
    } catch {
      return NextResponse.json({ error: 'Field mapping is not valid JSON.' }, { status: 400 });
    }
  }

  // Existing clients, for identity resolution. Only the columns matching needs.
  const existing = await db()
    .from('ag_clients')
    .select('id, first_name, last_name, date_of_birth, medicare_beneficiary_identifier, phone, email')
    .limit(MAX_CANDIDATES);

  if (existing.error && !isMissingTable(existing.error)) {
    return NextResponse.json({ error: existing.error.message }, { status: 500 });
  }
  const candidates = (existing.data ?? []) as ClientCandidate[];

  const { data: batch, error: batchError } = await db()
    .from('ag_import_batches')
    .insert({
      source_kind: 'csv_upload',
      source_label: sourceLabel,
      original_filename: file.name.slice(0, 200),
      file_size_bytes: file.size,
      file_sha256: sha256,
      row_count: parsed.rows.length,
      entity,
      field_mapping: mapping,
      status: 'draft',
    })
    .select('id')
    .single();

  if (batchError) {
    if (isMissingTable(batchError)) {
      return NextResponse.json(
        { error: 'Import staging tables are not present. Apply 20260729_import_batches.sql.' },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: batchError.message }, { status: 500 });
  }

  const seenInFile = new Map<string, number>();
  const records: Record<string, unknown>[] = [];
  const tally = { create: 0, match: 0, change: 0, unchanged: 0, duplicate: 0, ambiguous: 0, rejected: 0 };

  for (const [index, raw] of parsed.rows.entries()) {
    const rowNumber = index + 2; // +1 for header, +1 for 1-based
    const { normalized, issues } = normalizeRow(raw, mapping, entity);

    let disposition: keyof typeof tally;
    let clientId: string | null = null;
    let confidence: string | null = null;
    let matchCandidates: { id: string; reason: string }[] = [];

    if (issues.length > 0) {
      disposition = 'rejected';
    } else {
      // Within-file duplicates are caught before touching the CRM: two rows
      // for one person in one upload is a file problem, not a CRM problem.
      const key = rowDedupeKey(normalized);
      const firstSeen = key ? seenInFile.get(key) : undefined;
      if (key && firstSeen !== undefined) {
        disposition = 'duplicate';
        issues.push({ field: '_row', message: `Duplicate of row ${firstSeen} in this file` });
      } else {
        if (key) seenInFile.set(key, rowNumber);
        const match = matchClient(normalized, candidates);
        clientId = match.clientId;
        confidence = match.confidence;
        matchCandidates = match.candidates;
        disposition =
          match.disposition === 'create'
            ? 'create'
            : match.disposition === 'ambiguous'
              ? 'ambiguous'
              : changesSomething(normalized, candidates.find((c) => c.id === match.clientId))
                ? 'change'
                : 'unchanged';
      }
    }

    tally[disposition] += 1;
    records.push({
      batch_id: batch.id,
      row_number: rowNumber,
      raw,
      normalized,
      disposition,
      matched_client_id: clientId,
      match_confidence: confidence,
      match_candidates: matchCandidates,
      issues,
    });
  }

  // Chunked: a 10k-row insert in one statement is a timeout waiting to happen.
  for (let i = 0; i < records.length; i += 500) {
    const { error } = await db().from('ag_import_records').insert(records.slice(i, i + 500));
    if (error) {
      await db()
        .from('ag_import_batches')
        .update({ status: 'failed', error: error.message, updated_at: new Date().toISOString() })
        .eq('id', batch.id);
      return NextResponse.json({ error: `Staging failed: ${error.message}` }, { status: 500 });
    }
  }

  await db()
    .from('ag_import_batches')
    .update({
      status: 'previewed',
      created_count: tally.create,
      matched_count: tally.match + tally.change + tally.unchanged,
      changed_count: tally.change,
      rejected_count: tally.rejected,
      duplicate_count: tally.duplicate,
      updated_at: new Date().toISOString(),
    })
    .eq('id', batch.id);

  await recordAudit({
    action: 'import_batch_staged',
    entityType: 'ag_import_batches',
    entityId: batch.id,
    detail: { filename: file.name, sha256, rows: parsed.rows.length, entity, tally },
  });

  return NextResponse.json(
    {
      batchId: batch.id,
      entity,
      headers: parsed.headers,
      mapping,
      rowCount: parsed.rows.length,
      tally,
      // Nothing is applied yet, and the client is told so explicitly.
      committed: false,
    },
    { status: 201 },
  );
}

/** Does this row actually differ from the client it matched? */
function changesSomething(row: NormalizedRow, existing: ClientCandidate | undefined): boolean {
  if (!existing) return false;
  const comparisons: [unknown, unknown][] = [
    [row.phone, existing.phone],
    [row.email, existing.email],
    [row.date_of_birth, existing.date_of_birth],
    [row.medicare_beneficiary_identifier, existing.medicare_beneficiary_identifier],
  ];
  // Only a value that is present AND different counts. An absent incoming
  // value is not a proposal to blank the stored one.
  return comparisons.some(([incoming, current]) => incoming != null && incoming !== current);
}

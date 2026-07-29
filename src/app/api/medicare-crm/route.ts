import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase/admin';
import { requireMedicareOperator } from '@/lib/medicare-crm/auth';
// The row schemas in @/lib/medicare-crm/schemas are intentionally left in place
// even though this route no longer uses them — the staged import will validate
// against the same shapes, and re-deriving them later would risk drift.

export const runtime = 'nodejs';

// This route is protected by src/proxy.ts's operator session gate. The
// service-role client matches the rest of this dashboard's API architecture.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export async function GET(request: NextRequest) {
  const authError = await requireMedicareOperator(request);
  if (authError) return authError;

  try {
    const [agency, fmos, carriers, clients, notes, policies, communications, complianceDocuments] = await Promise.all([
      db().from('ag_agency_settings').select('*').order('created_at', { ascending: true }).limit(1).maybeSingle(),
      db().from('ag_fmos').select('*').order('created_at', { ascending: true }),
      db().from('ag_carriers').select('*').order('name', { ascending: true }),
      db().from('ag_clients').select('*').order('last_name', { ascending: true }).order('first_name', { ascending: true }),
      db().from('ag_client_notes').select('*').order('created_at', { ascending: false }).limit(500),
      db().from('ag_policies').select('*').order('effective_date', { ascending: false }),
      db().from('ag_communications_log').select('*').order('timestamp', { ascending: false }).limit(500),
      db().from('ag_compliance_documents').select('*').order('expires_at', { ascending: true, nullsFirst: false }),
    ]);

    const firstError = [agency, fmos, carriers, clients, notes, policies, communications, complianceDocuments].find((result) => result.error)?.error;
    if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 });

    return NextResponse.json({
      agencySettings: agency.data,
      fmos: fmos.data ?? [],
      carriers: carriers.data ?? [],
      clients: (clients.data ?? []).map((client: { medicare_beneficiary_identifier?: string | null }) => ({
        ...client,
        medicare_beneficiary_identifier: null,
        masked_mbi: maskMbiValue(client.medicare_beneficiary_identifier),
      })),
      notes: notes.data ?? [],
      policies: policies.data ?? [],
      communications: communications.data ?? [],
      complianceDocuments: complianceDocuments.data ?? [],
    });
  } catch (error) {
    return NextResponse.json({ error: `Medicare CRM data unavailable: ${String(error).slice(0, 180)}` }, { status: 500 });
  }
}

function maskMbiValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = value.replace(/\s+/g, '');
  return `••••••${compact.slice(-4)}`;
}

/**
 * Bulk import — withdrawn.
 *
 * This handler used to normalise spreadsheet rows and call
 * `.upsert(rows, { onConflict: 'id' })` on ag_clients, ag_carriers or
 * ag_policies. Three properties made it unsafe to keep:
 *
 *   • a row carrying an `id` overwrote the live record outright, with no
 *     comparison against the value being replaced
 *   • nothing recorded where an imported value came from, so a wrong plan code
 *     was indistinguishable from a verified one afterwards
 *   • there was no audit entry and no way to reverse a batch
 *
 * That is exactly the silent-overwrite path the coverage-review gate exists to
 * prevent, so leaving it reachable would have made the gate decorative. The
 * replacement stages a batch, previews each row against the current value, and
 * commits only what an operator approves.
 *
 * 410 rather than 404: the endpoint existed and was deliberately removed, and
 * a caller deserves to be told which of those it is hitting.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        'Direct bulk import has been withdrawn. It overwrote live client and policy records without review. Use the staged import batch flow instead.',
      code: 'import_withdrawn',
    },
    { status: 410 },
  );
}

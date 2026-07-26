import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase/admin';
import { requireMedicareOperator } from '@/lib/medicare-crm/auth';
import {
  MedicareCarrierImportRowSchema,
  MedicareClientImportRowSchema,
  MedicareImportSchema,
  MedicarePolicyImportRowSchema,
} from '@/lib/medicare-crm/schemas';

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

function textValue(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === undefined || value === null || String(value).trim() === '') return null;
  return String(value).trim();
}

function textArray(row: Record<string, unknown>, key: string): string[] {
  const value = row[key];
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value ?? '').split(/[,;|]/).map((item) => item.trim()).filter(Boolean);
}

function dateValue(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  return String(value).trim();
}

function moneyValue(row: Record<string, unknown>, key: string): number | null {
  const value = textValue(row, key);
  if (value === null) return null;
  return Number(value.replace(/[$,]/g, ''));
}

function maskMbiValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = value.replace(/\s+/g, '');
  return `••••••${compact.slice(-4)}`;
}

export async function POST(request: NextRequest) {
  const authError = await requireMedicareOperator(request);
  if (authError) return authError;

  const parsed = MedicareImportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid import payload', details: parsed.error.flatten() }, { status: 400 });

  const { entity, rows } = parsed.data;
  const normalized = rows.map((row) => {
    if (entity === 'clients') {
      return {
        ...(textValue(row, 'id') ? { id: textValue(row, 'id') } : {}),
        first_name: textValue(row, 'first_name') ?? '',
        last_name: textValue(row, 'last_name') ?? '',
        phone: textValue(row, 'phone'), email: textValue(row, 'email'), date_of_birth: dateValue(row, 'date_of_birth'),
        physical_address: textValue(row, 'physical_address'), city: textValue(row, 'city'), state: textValue(row, 'state'), zip: textValue(row, 'zip'),
        medicare_beneficiary_identifier: textValue(row, 'medicare_beneficiary_identifier'), tags: textArray(row, 'tags'),
      };
    }
    if (entity === 'carriers') {
      return {
        ...(textValue(row, 'id') ? { id: textValue(row, 'id') } : {}),
        name: textValue(row, 'name') ?? '', appointment_status: textValue(row, 'appointment_status') ?? 'pending',
        fmo_id: textValue(row, 'fmo_id'), lines_of_business: textArray(row, 'lines_of_business'), active_states: textArray(row, 'active_states'),
      };
    }
    return {
      ...(textValue(row, 'id') ? { id: textValue(row, 'id') } : {}),
      client_id: textValue(row, 'client_id') ?? '', carrier_id: textValue(row, 'carrier_id'), fmo_id: textValue(row, 'fmo_id'),
      plan_name: textValue(row, 'plan_name') ?? '', plan_id: textValue(row, 'plan_id'), effective_date: dateValue(row, 'effective_date'),
      monthly_premium: moneyValue(row, 'monthly_premium'),
      commission_level: textValue(row, 'commission_level'), status: textValue(row, 'status') ?? 'active',
    };
  });

  const rowSchema = entity === 'clients'
    ? MedicareClientImportRowSchema
    : entity === 'carriers'
      ? MedicareCarrierImportRowSchema
      : MedicarePolicyImportRowSchema;
  const invalidRow = normalized.findIndex((row) => !rowSchema.safeParse(row).success);
  if (invalidRow >= 0) {
    const issue = rowSchema.safeParse(normalized[invalidRow]);
    return NextResponse.json({ error: `Row ${invalidRow + 1} failed validation`, details: issue.success ? undefined : issue.error.flatten() }, { status: 400 });
  }

  const { data, error } = await db().from(`ag_${entity}`).upsert(normalized, { onConflict: 'id' }).select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ imported: data?.length ?? normalized.length }, { status: 201 });
}

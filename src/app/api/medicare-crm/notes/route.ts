import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase/admin';
import { requireMedicareOperator } from '@/lib/medicare-crm/auth';
import { MedicareNoteSchema } from '@/lib/medicare-crm/schemas';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export async function POST(request: NextRequest) {
  const authError = await requireMedicareOperator(request);
  if (authError) return authError;

  const parsed = MedicareNoteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'A client and note are required.' }, { status: 400 });

  const { data, error } = await db().from('ag_client_notes').insert({ ...parsed.data, created_by: 'operator' }).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ note: data }, { status: 201 });
}

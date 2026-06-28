/**
 * POST /api/vcc/bulk
 *
 * Batch-generate VCC / Insurance Transition Notice records for a set of
 * book_of_business members within the caller's agency.
 *
 * Access control:
 *   Requires agency_owner, agency_admin (manager), or customer_service role.
 *   Brokers are explicitly blocked — this endpoint bypasses broker_id isolation
 *   by design so staff can dispatch forms across the agency downline.
 *
 * Body:
 *   {
 *     member_ids: string[]          — book_of_business row UUIDs (max 200)
 *     form_type:  'vcc' | 'transition_notice'
 *     doctor_name?: string          — pre-fill physician name (optional)
 *     doctor_fax?:  string          — pre-fill fax number (optional)
 *     send_fax?:    boolean         — default false (bulk faxes require explicit opt-in)
 *   }
 *
 * Response:
 *   { queued: number, skipped: number, form_type: string }
 *
 * Implementation strategy:
 *   Single batched INSERT into vcc_submissions keyed on member data fetched
 *   in one SELECT. No per-row API calls or iterative loops.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient }        from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { decryptMbi }          from '@/lib/mbi-crypto'

export const dynamic = 'force-dynamic'

// ── Role gate ─────────────────────────────────────────────────────────────────
const ALLOWED_ROLES = new Set(['agency_owner', 'agency_admin', 'customer_service'])

async function resolveCallerScope(userId: string): Promise<{
  agencyId:   string
  brokerId:   string | null
  role:       string
} | null> {
  const supabase = await createClient()

  // Check agency ownership first
  const { data: agency } = await supabase
    .from('agencies')
    .select('id')
    .eq('owner_id', userId)
    .maybeSingle()

  if (agency) {
    return { agencyId: agency.id, brokerId: null, role: 'agency_owner' }
  }

  // Fallback: broker row
  const { data: broker } = await supabase
    .from('brokers')
    .select('id, agency_id, role')
    .eq('user_id', userId)
    .maybeSingle()

  if (!broker) return null
  return { agencyId: broker.agency_id, brokerId: broker.id, role: broker.role ?? 'broker' }
}

// ── Handler ───────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const scope = await resolveCallerScope(user.id)
  if (!scope) return NextResponse.json({ error: 'No agency profile found' }, { status: 403 })

  if (!ALLOWED_ROLES.has(scope.role)) {
    return NextResponse.json(
      { error: 'FORBIDDEN_BULK_VCC', message: 'Bulk VCC dispatch requires agency_owner, manager, or CSR role.' },
      { status: 403 }
    )
  }

  let body: {
    member_ids: string[]
    form_type?:   'vcc' | 'transition_notice'
    doctor_name?: string
    doctor_fax?:  string
    send_fax?:    boolean
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const memberIds = (body.member_ids ?? []).slice(0, 200)  // hard cap
  if (memberIds.length === 0) {
    return NextResponse.json({ error: 'member_ids array is required and must not be empty' }, { status: 400 })
  }

  const formType = body.form_type ?? 'vcc'
  const sendFax  = body.send_fax  ?? false

  const svc = createServiceClient()

  // ── Single batched member fetch — scoped to caller's agency ───────────────
  // broker_id constraint intentionally omitted: staff operate across downline.
  // Fetch doctor_name and doctor_fax from member record for auto-fill fallback
  const { data: members, error: fetchErr } = await svc
    .from('book_of_business')
    .select('id, agency_id, broker_id, full_name, mbi_encrypted, carrier, plan_name, doctor_name, doctor_fax')
    .in('id', memberIds)
    .eq('agency_id', scope.agencyId)

  if (fetchErr) {
    console.error('[vcc/bulk] member fetch error:', fetchErr.message)
    return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 })
  }

  if (!members || members.length === 0) {
    return NextResponse.json(
      { error: 'No members found in your agency matching the provided IDs' },
      { status: 404 }
    )
  }

  const now = new Date().toISOString()

  // ── Single batched INSERT into vcc_submissions ────────────────────────────
  // Auto-fill mapping: use request body values first, fall back to member record data
  const rows = members.map(m => ({
    agency_id:   scope.agencyId,
    broker_id:   m.broker_id ?? scope.brokerId,   // fall back to caller's broker_id if unassigned
    initiated_by: user.id,
    bob_member_id: m.id,
    // Golden data pillars from member record
    client_name:   m.full_name ?? null,
    // Decrypted server-side — vcc_submissions.medicare_id feeds the carrier fax PDF
    medicare_id:   decryptMbi(m.mbi_encrypted),
    carrier:       m.carrier   ?? null,
    plan_name:     m.plan_name ?? null,
    form_type:     formType,
    // Doctor info: request body takes priority, fallback to member record
    doctor_name:   body.doctor_name ?? m.doctor_name ?? null,
    doctor_fax:    body.doctor_fax  ?? m.doctor_fax  ?? null,
    send_fax:      sendFax,
    fax_status:    sendFax ? 'pending' : 'no_fax',
    source:        'bulk',
    created_at:    now,
    updated_at:    now,
  }))

  const { error: insertErr } = await svc
    .from('vcc_submissions')
    .insert(rows)

  if (insertErr) {
    console.error('[vcc/bulk] insert error:', insertErr.message)
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  // ── Compliance log ────────────────────────────────────────────────────────
  await svc.from('audit_log').insert({
    agency_id:     scope.agencyId,
    user_id:       user.id,
    action:        'BULK_VCC_DISPATCHED',
    resource_type: 'vcc_submissions',
    resource_id:   scope.agencyId,
    metadata: {
      form_type:  formType,
      count:      rows.length,
      send_fax:   sendFax,
      role:       scope.role,
    }
  }) // Fixed missing closing bracket here

  console.log(`[vcc/bulk] dispatched ${rows.length} ${formType} forms by ${scope.role} ${user.id}`)

  return NextResponse.json({
    queued:    rows.length,
    skipped:   memberIds.length - members.length,
    form_type: formType,
  })
}
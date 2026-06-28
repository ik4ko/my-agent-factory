/**
 * POST /api/campaigns/bulk
 *
 * Batch-enroll a set of book_of_business members into a retention campaign
 * and queue Maya AI outreach scripts for each alert in the 'mitigating' state.
 *
 * Access control:
 *   Requires agency_owner, agency_admin (manager), or customer_service role.
 *   Brokers are explicitly blocked — staff can dispatch across the full
 *   agency downline without broker_id isolation.
 *
 * Body:
 *   {
 *     member_ids:    string[]   — book_of_business UUIDs to enroll (max 200)
 *     campaign_type: string     — e.g. 'retention', 'aep_reminder', 'transition_notice'
 *     message?:      string     — optional custom message prefix for the outreach
 *   }
 *
 * Response:
 *   { enrolled: number, skipped: number, campaign_type: string }
 *
 * Implementation strategy:
 *   1. Single SELECT to fetch validated members scoped to the agency.
 *   2. Single batched INSERT into campaign_enrollments — one row per member.
 *   3. Single batched UPDATE on switch_alerts to set status='mitigating'
 *      for open alerts belonging to those members, enabling the Scripts
 *      Workspace to generate Maya AI scripts for each.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient }        from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

// ── Role gate ─────────────────────────────────────────────────────────────────
const ALLOWED_ROLES = new Set(['agency_owner', 'agency_admin', 'customer_service'])

async function resolveCallerScope(userId: string): Promise<{
  agencyId: string
  brokerId: string | null
  role:     string
} | null> {
  const supabase = await createClient()

  const { data: agency } = await supabase
    .from('agencies')
    .select('id')
    .eq('owner_id', userId)
    .maybeSingle()

  if (agency) {
    return { agencyId: agency.id, brokerId: null, role: 'agency_owner' }
  }

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
      { error: 'FORBIDDEN_BULK_CAMPAIGN', message: 'Bulk campaign dispatch requires agency_owner, manager, or CSR role.' },
      { status: 403 }
    )
  }

  let body: {
    member_ids:    string[]
    campaign_type: string
    message?:      string
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const memberIds    = (body.member_ids ?? []).slice(0, 200)
  const campaignType = (body.campaign_type ?? 'retention').trim()

  if (memberIds.length === 0) {
    return NextResponse.json({ error: 'member_ids array is required and must not be empty' }, { status: 400 })
  }
  if (!campaignType) {
    return NextResponse.json({ error: 'campaign_type is required' }, { status: 400 })
  }

  const svc = createServiceClient()

  // ── Single batched member fetch — no broker_id filter (staff scope) ───────
  // Fetch plan_name for template injection and broker info for sender context
  const { data: members, error: fetchErr } = await svc
    .from('book_of_business')
    .select('id, broker_id, full_name, plan_name')
    .in('id', memberIds)
    .eq('agency_id', scope.agencyId)

  if (fetchErr) {
    console.error('[campaigns/bulk] member fetch error:', fetchErr.message)
    return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 })
  }

  if (!members || members.length === 0) {
    return NextResponse.json(
      { error: 'No members found in your agency matching the provided IDs' },
      { status: 404 }
    )
  }

  const now        = new Date().toISOString()
  const validMbIds = members.map(m => m.id)

  // ── Fetch broker name for template injection ──────────────────────────────
  const { data: broker } = await svc
    .from('brokers')
    .select('full_name')
    .eq('id', scope.brokerId ?? '')
    .maybeSingle()
  const brokerName = broker?.full_name ?? 'Your Broker'

  // ── Template tag replacement function ─────────────────────────────────────
  function replaceTemplateTags(message: string, member: { full_name?: string | null; plan_name?: string | null }): string {
    if (!message) return ''
    return message
      .replace(/\{member_name\}/g, member.full_name || 'Member')
      .replace(/\{plan_name\}/g, member.plan_name || 'your plan')
      .replace(/\{broker_name\}/g, brokerName)
  }

  // ── Op 1: Batched campaign_enrollments INSERT ─────────────────────────────
  // Apply template tag replacement to message for each member
  const enrollmentRows = members.map(m => ({
    agency_id:     scope.agencyId,
    broker_id:     m.broker_id ?? scope.brokerId,
    bob_member_id: m.id,
    enrolled_by:   user.id,
    campaign_type: campaignType,
    status:        'active',
    message:       body.message ? replaceTemplateTags(body.message, m) : null,
    source:        'bulk_staff',
    created_at:    now,
    updated_at:    now,
  }))

  const { error: enrollErr } = await svc
    .from('campaign_enrollments')
    .insert(enrollmentRows)

  if (enrollErr) {
    // Non-fatal on duplicate key (member already enrolled) — log and continue
    console.warn('[campaigns/bulk] enrollment insert warning:', enrollErr.message)
  }

  // ── Op 2: Batched switch_alert status → 'mitigating' ─────────────────────
  // Transitions all open/contacted alerts for these members so they appear in
  // the Scripts Workspace queue for Maya AI script generation.
  const { error: alertErr } = await svc
    .from('switch_alerts')
    .update({ status: 'mitigating', updated_at: now })
    .eq('agency_id', scope.agencyId)
    .in('bob_member_id', validMbIds)
    .in('status', ['open', 'contacted'])

  if (alertErr) {
    console.warn('[campaigns/bulk] alert status update warning:', alertErr.message)
  }

  // ── Compliance log ────────────────────────────────────────────────────────
  await svc.from('audit_log').insert({
    agency_id:     scope.agencyId,
    user_id:       user.id,
    action:        'BULK_CAMPAIGN_DISPATCHED',
    resource_type: 'campaign_enrollments',
    resource_id:   scope.agencyId,
    metadata: {
      campaign_type: campaignType,
      count:         members.length,
      role:          scope.role,
      message_template: body.message ? 'custom' : 'default',
    },
  })

  // ── Outbound logging for dashboard tracking ────────────────────────────────
  // Log each enrollment as a pending outbound message for dashboard display
  const outboundLogs = members.map(m => ({
    agency_id:     scope.agencyId,
    user_id:       user.id,
    action:        'CAMPAIGN_MESSAGE_QUEUED',
    resource_type: 'campaign_enrollments',
    resource_id:   m.id,
    metadata: {
      campaign_type: campaignType,
      member_name:   m.full_name,
      message:       body.message ? replaceTemplateTags(body.message, m) : null,
      status:        'pending',
    },
    created_at:    now,
  }))

  await svc.from('audit_log').insert(outboundLogs)

  console.log(`[campaigns/bulk] enrolled ${members.length} members into '${campaignType}' by ${scope.role} ${user.id}`)

  return NextResponse.json({
    enrolled:      members.length,
    skipped:       memberIds.length - members.length,
    campaign_type: campaignType,
  })
}
/**
 * GET /api/team/seat-check
 *
 * Returns the current seat utilisation for the authenticated user's agency.
 * Called by the Team management UI before rendering the "Invite Broker" button
 * so the frontend can show accurate seat counts, overage warnings, and upgrade
 * prompts without waiting for an invite attempt to fail.
 *
 * POST /api/team/seat-check
 *
 * Validates whether a new seat can be added before any invite is sent.
 * Returns a structured result the frontend can use to gate the action or
 * surface an upgrade prompt.
 *
 * Both methods use checkSeatLimit() from src/lib/billing/seat-guard.ts
 * which is the application-layer pre-check that mirrors the DB trigger in
 * migration 20260528080000. Showing a clear error message is better UX
 * than letting the DB trigger exception surface as a generic 500.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient }        from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { checkSeatLimit }      from '@/lib/billing/seat-guard'
import { extractIp }           from '@/utils/auditLogger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// ── GET — current seat status ─────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const svc = createServiceClient()

  // Resolve agency from session
  const agencyId = await resolveAgencyId(svc, user.id)
  if (!agencyId) {
    return NextResponse.json({ error: 'No agency found for your account' }, { status: 404 })
  }

  // Guard requires ownership or manager role
  const isAuthorized = await isOwnerOrManager(svc, user.id, agencyId)
  if (!isAuthorized) {
    return NextResponse.json(
      { error: 'Only agency owners and managers can view seat usage.' },
      { status: 403 }
    )
  }

  const result = await checkSeatLimit(agencyId, user.id, extractIp(req))

  return NextResponse.json({
    agencyId,
    currentSeats:   result.currentSeats,
    includedSeats:  result.includedSeats,
    maxSeats:       result.maxSeats,
    overageSeats:   result.overageSeats,
    overageBilled:  result.overageBilled,
    tier:           result.tier,
    canAddSeat:     result.allowed,
    userMessage:    result.userMessage,
  })
}

// ── POST — validate before invite ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const svc = createServiceClient()

  const agencyId = await resolveAgencyId(svc, user.id)
  if (!agencyId) {
    return NextResponse.json({ error: 'No agency found for your account' }, { status: 404 })
  }

  const isAuthorized = await isOwnerOrManager(svc, user.id, agencyId)
  if (!isAuthorized) {
    return NextResponse.json(
      { error: 'Only agency owners and managers can invite broker seats.' },
      { status: 403 }
    )
  }

  const result = await checkSeatLimit(agencyId, user.id, extractIp(req))

  if (!result.allowed) {
    return NextResponse.json(
      {
        allowed:      false,
        reason:       result.reason,
        userMessage:  result.userMessage,
        currentSeats: result.currentSeats,
        maxSeats:     result.maxSeats,
        tier:         result.tier,
        upgradeUrl:   '/dashboard/billing',
      },
      { status: 402 }  // Payment Required — upgrade prompt
    )
  }

  return NextResponse.json({
    allowed:       true,
    currentSeats:  result.currentSeats,
    includedSeats: result.includedSeats,
    overageSeats:  result.overageSeats,
    overageBilled: result.overageBilled,
    tier:          result.tier,
    userMessage:   result.userMessage,  // overage cost warning if applicable
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveAgencyId(
  svc:    ReturnType<typeof createServiceClient>,
  userId: string,
): Promise<string | null> {
  const [{ data: ownerRow }, { data: brokerRow }] = await Promise.all([
    svc.from('agencies').select('id').eq('owner_id', userId).maybeSingle(),
    svc.from('brokers').select('agency_id').eq('user_id', userId).maybeSingle(),
  ])
  return ownerRow?.id ?? brokerRow?.agency_id ?? null
}

async function isOwnerOrManager(
  svc:      ReturnType<typeof createServiceClient>,
  userId:   string,
  agencyId: string,
): Promise<boolean> {
  const { data: ownerRow } = await svc
    .from('agencies')
    .select('id')
    .eq('id', agencyId)
    .eq('owner_id', userId)
    .maybeSingle()

  if (ownerRow) return true

  const { data: brokerRow } = await svc
    .from('brokers')
    .select('role')
    .eq('user_id', userId)
    .eq('agency_id', agencyId)
    .maybeSingle()

  return ['agency_owner', 'agency_admin'].includes(brokerRow?.role ?? '')
}

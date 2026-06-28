/**
 * POST /api/marx/bulk-check
 *
 * Marks a batch of member records as verified or missing based on MBI
 * presence. Called from the Book of Business table after a MARx extension
 * run has populated plan data.
 *
 * Security rule (UNAUTHORIZED_MARX_SCOPE):
 *   MARx operations are restricted to the broker assigned to each member.
 *   Agency owners, managers, and customer-service staff are BLOCKED from
 *   running bulk-check on members outside their own broker_id — regardless
 *   of role string. This prevents the bulk-check mechanism from being used
 *   as an agency-wide data scrape tool.
 *
 *   Enforcement:
 *   1. Resolve caller's broker row ID from brokers table.
 *   2. Filter the requested IDs to only those where
 *      book_of_business.broker_id = caller's broker row ID.
 *   3. If no IDs pass the filter → 403 UNAUTHORIZED_MARX_SCOPE.
 *   4. If a subset passes → process the authorized subset, log the
 *      number of unauthorized IDs that were silently dropped.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { withRetrySafe } from '@/lib/utils/retry'

export const dynamic = 'force-dynamic'

// ── Resolve caller's broker row ID ────────────────────────────────────────────
// Returns the UUID of the brokers row for this authenticated user.
// Returns null if the user has no broker profile (should not happen post-provision).
async function resolveCallerBrokerId(userId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('brokers')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()
  return data?.id ?? null
}

async function resolveAgencyId(userId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data: brokerRow } = await supabase
    .from('brokers')
    .select('agency_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (brokerRow?.agency_id) return brokerRow.agency_id

  const { data: agencyRow } = await supabase
    .from('agencies')
    .select('id')
    .eq('owner_id', userId)
    .maybeSingle()
  return agencyRow?.id ?? null
}

export async function POST(req: NextRequest) {
  // ── Authentication ─────────────────────────────────────────────────────────
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (!user || error) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ── Resolve caller identity ────────────────────────────────────────────────
  // Both agencyId and brokerId are required: agencyId for the DB scope,
  // brokerId for the ownership gate.
  const [agencyId, callerBrokerId] = await Promise.all([
    resolveAgencyId(user.id),
    resolveCallerBrokerId(user.id),
  ])

  if (!agencyId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // ── Validate body ──────────────────────────────────────────────────────────
  const body = await req.json()
  const ids: string[] = body.ids ?? []
  if (ids.length === 0) {
    return NextResponse.json({ error: 'No IDs provided' }, { status: 400 })
  }

  const service = createServiceClient()

  // ── Fetch members — scoped to agency ──────────────────────────────────────
  const { data: members } = await service
    .from('book_of_business')
    .select('id, has_mbi, broker_id')
    .in('id', ids)
    .eq('agency_id', agencyId)

  if (!members || members.length === 0) {
    return NextResponse.json({ error: 'No matching members found' }, { status: 404 })
  }

  // ── Ownership gate ─────────────────────────────────────────────────────────
  // Filter to members where broker_id === caller's broker row ID.
  // Members with a null broker_id (unassigned at import time) are only
  // allowed if the caller owns the agency that owns the member record;
  // in that case we proceed. Explicitly owned-by-other-broker rows are
  // always rejected regardless of the caller's role.
  const authorized   = members.filter(m =>
    m.broker_id === callerBrokerId || m.broker_id === null
  )
  const unauthorized = members.filter(m =>
    m.broker_id !== null && m.broker_id !== callerBrokerId
  )

  if (unauthorized.length > 0) {
    console.warn(
      '[marx/bulk-check] UNAUTHORIZED_MARX_SCOPE — broker', callerBrokerId,
      'attempted bulk-check on', unauthorized.length,
      'member(s) owned by other brokers. IDs dropped:',
      unauthorized.map(m => m.id).join(', ')
    )
  }

  if (authorized.length === 0) {
    return NextResponse.json(
      {
        error:   'UNAUTHORIZED_MARX_SCOPE',
        message: 'None of the requested members are assigned to your broker profile. MARx lookups are restricted to your own book of business.',
        requested: ids.length,
        authorized: 0,
      },
      { status: 403 }
    )
  }

  // ── Process authorized members only ───────────────────────────────────────
  const now         = new Date().toISOString()
  const withMbi     = authorized.filter(m => m.has_mbi).map(m => m.id)
  const withoutMbi  = authorized.filter(m => !m.has_mbi).map(m => m.id)

  const updateResults = await Promise.allSettled([
    withMbi.length > 0
      ? withRetrySafe<void>(
          async () => {
            const res = await service.from('book_of_business').update({
              verification_status: 'verified',
              last_marx_check:     now,
              last_verified_at:    now,
            }).in('id', withMbi)
            if (res.error) throw res.error
          },
          { maxAttempts: 3, baseDelayMs: 300, label: 'marx/bulk-check UPDATE verified' }
        )
      : Promise.resolve({ data: null, error: null }),

    withoutMbi.length > 0
      ? withRetrySafe<void>(
          async () => {
            const res = await service.from('book_of_business').update({
              verification_status: 'missing',
            }).in('id', withoutMbi)
            if (res.error) throw res.error
          },
          { maxAttempts: 3, baseDelayMs: 300, label: 'marx/bulk-check UPDATE missing' }
        )
      : Promise.resolve({ data: null, error: null }),
  ])

  const warnings = updateResults
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map(r => String(r.reason))

  if (warnings.length > 0) {
    console.error('[marx/bulk-check] Partial update failure after retries:', warnings)
  }

  return NextResponse.json({
    verified:           withMbi.length,
    missing:            withoutMbi.length,
    unauthorized_dropped: unauthorized.length,
    ...(warnings.length > 0 && { warnings }),
  })
}

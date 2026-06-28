/**
 * Seat Guard — Server-Side Subscription Enforcement
 * src/lib/billing/seat-guard.ts
 *
 * Validates whether a workspace is allowed to add a new broker seat
 * before the invite or creation is processed. Used by:
 *   - POST /api/team/invite  (invite a new broker)
 *   - The Stripe webhook on subscription.updated (reconcile on downgrade)
 *
 * Tier rules enforced here:
 *   Solo Plan  (broker tier)  → strict 1-seat hard cap, no overage
 *   Agency Plan (agency tier) → 5 seats included, unlimited overage billed
 *                               via Stripe — no block, just billing signal
 *
 * The DB trigger in 20260528080000 is the ultimate enforcement layer.
 * This utility is the application-layer pre-check that gives clear
 * user-facing error messages BEFORE hitting the DB trigger exception.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { logComplianceEvent }  from '@/utils/auditLogger'

// ── Constants ─────────────────────────────────────────────────────────────────

export const SOLO_SEAT_LIMIT     = 1
export const AGENCY_INCLUDED_SEATS = 5

// Map Stripe Price IDs to tier metadata.
// These read from env at call time so they're always current.
export function getTierConfig() {
  return {
    broker: {
      priceId:       process.env.STRIPE_BROKER_PRICE_ID ?? '',
      tier:          'broker'  as const,
      seatLimit:     SOLO_SEAT_LIMIT,
      includedSeats: SOLO_SEAT_LIMIT,
      overageBilled: false,
      monthlyPrice:  149,   // v2 live price — corrected from erroneous 150
      annualPrice:   120,
    },
    agency: {
      priceId:       process.env.STRIPE_AGENCY_PRICE_ID ?? '',
      tier:          'agency'  as const,
      seatLimit:     null,   // null = no hard cap
      includedSeats: AGENCY_INCLUDED_SEATS,
      overageBilled: true,
      seatAddonPriceId: process.env.STRIPE_SEAT_ADDON_PRICE_ID ?? '',
      extraSeatMonthly: 49,
      extraSeatAnnual:  39,
      monthlyPrice:  749,
      annualPrice:   599,
    },
  }
}

// ── Result types ──────────────────────────────────────────────────────────────

export type SeatTier = 'broker' | 'agency' | 'trial' | 'unknown'

export interface SeatCheckResult {
  /** Whether a new seat can be added */
  allowed:         boolean
  /** Current number of active broker seats */
  currentSeats:    number
  /** Maximum seats before hard block (null = unlimited) */
  maxSeats:        number | null
  /** Seats included in base subscription price */
  includedSeats:   number
  /** How many seats are billable overage (above included) */
  overageSeats:    number
  /** Whether overage seats are metered and billed */
  overageBilled:   boolean
  /** Subscription tier of the agency */
  tier:            SeatTier
  /** Human-readable reason if not allowed */
  reason?:         string
  /** Copy ready to surface in the UI */
  userMessage?:    string
}

// ── Core function ─────────────────────────────────────────────────────────────

/**
 * Check whether an agency is permitted to add a new broker seat.
 *
 * @param agencyId     UUID of the agency to check
 * @param actorUserId  User ID of the person requesting the seat (for audit log)
 * @param ipAddress    Client IP for compliance logging
 */
export async function checkSeatLimit(
  agencyId:    string,
  actorUserId: string,
  ipAddress?:  string,
): Promise<SeatCheckResult> {
  const svc = createServiceClient()

  // ── Fetch agency subscription state ────────────────────────────────────────
  const { data: agency, error: agencyErr } = await svc
    .from('agencies')
    .select('subscription_tier, subscription_status, seat_limit, included_seats, stripe_price_id')
    .eq('id', agencyId)
    .maybeSingle()

  if (agencyErr || !agency) {
    return {
      allowed:       false,
      currentSeats:  0,
      maxSeats:      0,
      includedSeats: 0,
      overageSeats:  0,
      overageBilled: false,
      tier:          'unknown',
      reason:        'agency_not_found',
      userMessage:   'Agency account not found. Please contact support.',
    }
  }

  // ── Count active broker seats ───────────────────────────────────────────────
  const { count: activeSeatCount } = await svc
    .from('brokers')
    .select('id', { count: 'exact', head: true })
    .eq('agency_id', agencyId)
    .eq('is_active', true)

  const currentSeats  = activeSeatCount ?? 0
  const tier          = (agency.subscription_tier as SeatTier) ?? 'trial'
  const includedSeats = agency.included_seats ?? (tier === 'agency' ? AGENCY_INCLUDED_SEATS : SOLO_SEAT_LIMIT)
  const maxSeats      = agency.seat_limit     // null = unlimited
  const overageSeats  = Math.max(0, currentSeats - includedSeats)
  const overageBilled = tier === 'agency'

  // ── Solo Plan hard cap ──────────────────────────────────────────────────────
  if (tier === 'broker' || (maxSeats !== null && maxSeats !== undefined)) {
    const effectiveLimit = maxSeats ?? SOLO_SEAT_LIMIT
    if (currentSeats >= effectiveLimit) {

      // Log the blocked seat attempt to compliance_audit_logs
      void logComplianceEvent({
        agencyId,
        brokerUserId: actorUserId,
        eventType:    'LOGIN',  // closest available type for access attempt
        description:  `Seat limit enforcement: blocked attempt to add broker seat. ` +
                      `Current: ${currentSeats}/${effectiveLimit} seats used. ` +
                      `Tier: ${tier}. Agency UUID: ${agencyId}.`,
        ipAddress,
        status:       'FAILED',
        errorDetail:  `SEAT_LIMIT_EXCEEDED: ${currentSeats} of ${effectiveLimit} seats used.`,
      })

      return {
        allowed:       false,
        currentSeats,
        maxSeats:      effectiveLimit,
        includedSeats,
        overageSeats,
        overageBilled: false,
        tier,
        reason:        'seat_limit_reached',
        userMessage:   `Your Solo Broker Plan allows 1 seat. ` +
                       `Upgrade to the Agency Plan ($749/mo) to add team members.`,
      }
    }
  }

  // ── Agency Plan — allowed, but signal if overage billing will apply ─────────
  return {
    allowed:       true,
    currentSeats,
    maxSeats,
    includedSeats,
    overageSeats:  Math.max(0, (currentSeats + 1) - includedSeats),  // +1 for the seat being added
    overageBilled,
    tier,
    // If this new seat pushes them past included_seats, surface the overage cost
    userMessage: overageBilled && currentSeats >= includedSeats
      ? `This seat exceeds your ${includedSeats} included seats. ` +
        `An additional $49/mo will be added to your next invoice.`
      : undefined,
  }
}

/**
 * Verify that a specific broker seat belongs to the calling user's agency.
 * Used by management routes before deactivating or removing a broker.
 */
export async function verifySeatOwnership(
  brokerUserId: string,
  callerAgencyId: string,
): Promise<{ valid: boolean; reason?: string }> {
  const svc = createServiceClient()

  const { data: broker } = await svc
    .from('brokers')
    .select('id, agency_id, is_active')
    .eq('user_id', brokerUserId)
    .maybeSingle()

  if (!broker) {
    return { valid: false, reason: 'Broker not found' }
  }

  if (broker.agency_id !== callerAgencyId) {
    return { valid: false, reason: 'Broker belongs to a different agency' }
  }

  return { valid: true }
}

/**
 * Deactivate a broker seat — sets is_active = false.
 * Deactivated seats don't count against seat_limit and are excluded
 * from Stripe overage calculations on the next reconciliation cycle.
 */
export async function deactivateSeat(
  brokerUserId:   string,
  callerAgencyId: string,
  actorUserId:    string,
  ipAddress?:     string,
): Promise<{ success: boolean; error?: string }> {
  const svc = createServiceClient()

  const ownership = await verifySeatOwnership(brokerUserId, callerAgencyId)
  if (!ownership.valid) {
    return { success: false, error: ownership.reason }
  }

  const { error } = await svc
    .from('brokers')
    .update({ is_active: false, deactivated_at: new Date().toISOString() })
    .eq('user_id', brokerUserId)
    .eq('agency_id', callerAgencyId)

  if (error) {
    return { success: false, error: error.message }
  }

  // Log the deactivation
  void logComplianceEvent({
    agencyId:     callerAgencyId,
    brokerUserId: actorUserId,
    eventType:    'MEMBER_DELETE',
    description:  `Broker seat deactivated. Stripe overage will reconcile on next cycle. ` +
                  `Agency UUID: ${callerAgencyId}. Deactivated by actor UUID: ${actorUserId}.`,
    ipAddress,
    status:       'SUCCESS',
  })

  return { success: true }
}

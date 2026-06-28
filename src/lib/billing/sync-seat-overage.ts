/**
 * Stripe Seat Overage Reconciliation Engine
 * src/lib/billing/sync-seat-overage.ts
 *
 * Calculates the exact number of overage broker seats for an agency and
 * updates the Stripe subscription item quantity accordingly.
 *
 * Called from:
 *   1. The Stripe webhook (customer.subscription.updated / invoice events)
 *   2. The daily cron job (GET /api/scheduler/detection → triggers reconcile)
 *   3. Any server action that adds or deactivates a broker seat
 *
 * Overage model:
 *   Agency Plan includes 5 seats. Each active seat beyond 5 is billed at
 *   $49/mo (monthly) or $39/mo (annual) via the STRIPE_SEAT_ADDON_PRICE_ID
 *   subscription item. Setting quantity = 0 removes the overage line from
 *   the invoice without cancelling the subscription item.
 *
 * Idempotency:
 *   The function reads current Stripe quantity before updating. If the
 *   Stripe quantity already matches, no API call is made — safe to run
 *   on every webhook event without burning Stripe API quota.
 */

import Stripe   from 'stripe'
import { getStripe }          from '@/lib/stripe'
import { createServiceClient } from '@/lib/supabase/service'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SeatSyncResult {
  agencyId:          string
  activeSeats:       number
  includedSeats:     number
  overageQuantity:   number
  previousQuantity:  number | null
  updated:           boolean
  stripeItemId:      string | null
  error?:            string
}

// ── Core reconciliation function ──────────────────────────────────────────────

/**
 * Reconcile the Stripe seat add-on quantity with the actual active broker count.
 *
 * @param agencyId  UUID of the agency to reconcile
 * @returns         Detailed reconciliation result for audit logging
 */
export async function syncSeatOverage(agencyId: string): Promise<SeatSyncResult> {
  const svc    = createServiceClient()
  const stripe = getStripe()

  // ── 1. Fetch agency subscription data ──────────────────────────────────────
  const { data: agency, error: agencyErr } = await svc
    .from('agencies')
    .select('stripe_subscription_id, stripe_customer_id, subscription_tier, included_seats')
    .eq('id', agencyId)
    .maybeSingle()

  if (agencyErr || !agency) {
    return makeError(agencyId, 0, 0, `Agency not found: ${agencyErr?.message ?? 'no row'}`)
  }

  // Only agency tier has overage billing — Solo Plan is a hard cap, not metered
  if (agency.subscription_tier !== 'agency') {
    return {
      agencyId,
      activeSeats:      0,
      includedSeats:    1,
      overageQuantity:  0,
      previousQuantity: null,
      updated:          false,
      stripeItemId:     null,
    }
  }

  if (!agency.stripe_subscription_id) {
    return makeError(agencyId, 0, 0, 'No active Stripe subscription ID on agency record')
  }

  const includedSeats = agency.included_seats ?? 5

  // ── 2. Count active broker seats ───────────────────────────────────────────
  const { count: activeCount } = await svc
    .from('brokers')
    .select('id', { count: 'exact', head: true })
    .eq('agency_id', agencyId)
    .eq('is_active', true)

  const activeSeats    = activeCount ?? 0
  const overageQuantity = Math.max(0, activeSeats - includedSeats)

  // ── 3. Fetch the Stripe subscription and find the seat add-on item ─────────
  let subscription: Stripe.Subscription
  try {
    subscription = await stripe.subscriptions.retrieve(
      agency.stripe_subscription_id,
      { expand: ['items.data.price'] }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return makeError(agencyId, activeSeats, includedSeats, `Stripe subscription fetch failed: ${msg}`)
  }

  const seatAddonPriceId = process.env.STRIPE_SEAT_ADDON_PRICE_ID
  if (!seatAddonPriceId) {
    return makeError(agencyId, activeSeats, includedSeats, 'STRIPE_SEAT_ADDON_PRICE_ID env var not set')
  }

  // Find the seat add-on line item in the subscription
  const seatItem = subscription.items.data.find(
    item => item.price.id === seatAddonPriceId
  )

  // ── 4. Idempotency check — skip if quantity already matches ────────────────
  if (seatItem && seatItem.quantity === overageQuantity) {
    return {
      agencyId,
      activeSeats,
      includedSeats,
      overageQuantity,
      previousQuantity: seatItem.quantity,
      updated:          false,
      stripeItemId:     seatItem.id,
    }
  }

  // ── 5. Update or create the seat add-on item in Stripe ────────────────────
  try {
    if (seatItem) {
      // Update existing seat add-on item quantity
      await stripe.subscriptionItems.update(seatItem.id, {
        quantity:           overageQuantity,
        payment_behavior:  'pending_if_incomplete',
        proration_behavior: 'always_invoice',
      })

      return {
        agencyId,
        activeSeats,
        includedSeats,
        overageQuantity,
        previousQuantity: seatItem.quantity ?? null,
        updated:          true,
        stripeItemId:     seatItem.id,
      }
    } else if (overageQuantity > 0) {
      // No seat add-on item exists yet — create one
      const newItem = await stripe.subscriptionItems.create({
        subscription:       agency.stripe_subscription_id,
        price:              seatAddonPriceId,
        quantity:           overageQuantity,
        payment_behavior:  'pending_if_incomplete',
        proration_behavior: 'always_invoice',
      })

      return {
        agencyId,
        activeSeats,
        includedSeats,
        overageQuantity,
        previousQuantity: 0,
        updated:          true,
        stripeItemId:     newItem.id,
      }
    } else {
      // No overage and no existing item — nothing to do
      return {
        agencyId,
        activeSeats,
        includedSeats,
        overageQuantity: 0,
        previousQuantity: 0,
        updated:          false,
        stripeItemId:     null,
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return makeError(
      agencyId, activeSeats, includedSeats,
      `Stripe subscription item update failed: ${msg}`
    )
  }
}

/**
 * Reconcile seat overage for ALL active Agency Plan subscriptions.
 * Called by the daily scheduler cron job.
 * Returns a summary of all agencies reconciled and any errors.
 */
export async function syncAllAgencyOverages(): Promise<{
  reconciled: number
  errors: number
  details: SeatSyncResult[]
}> {
  const svc = createServiceClient()

  // Fetch all active Agency Plan subscriptions that have a Stripe sub ID
  const { data: agencies } = await svc
    .from('agencies')
    .select('id')
    .eq('subscription_tier', 'agency')
    .eq('subscription_status', 'active')
    .not('stripe_subscription_id', 'is', null)

  if (!agencies || agencies.length === 0) {
    return { reconciled: 0, errors: 0, details: [] }
  }

  const results: SeatSyncResult[] = []
  let reconciled = 0
  let errors     = 0

  // Process sequentially to avoid Stripe rate limits
  for (const agency of agencies) {
    const result = await syncSeatOverage(agency.id)
    results.push(result)
    if (result.error) {
      errors++
      console.error(`[seat-sync] reconciliation failed for agency ${agency.id}:`, result.error)
    } else {
      reconciled++
      if (result.updated) {
        console.log(
          `[seat-sync] updated overage for agency ${agency.id}: ` +
          `${result.previousQuantity ?? 0} → ${result.overageQuantity} overage seats`
        )
      }
    }

    // Small delay between agencies to be a good Stripe API citizen
    await new Promise(r => setTimeout(r, 100))
  }

  return { reconciled, errors, details: results }
}

// ── Internal helper ───────────────────────────────────────────────────────────

function makeError(
  agencyId:     string,
  activeSeats:  number,
  includedSeats: number,
  error:        string,
): SeatSyncResult {
  return {
    agencyId,
    activeSeats,
    includedSeats,
    overageQuantity:  0,
    previousQuantity: null,
    updated:          false,
    stripeItemId:     null,
    error,
  }
}

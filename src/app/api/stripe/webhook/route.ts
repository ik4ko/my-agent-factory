/**
 * POST /api/stripe/webhook
 *
 * Complete Stripe webhook handler for AegisSage billing lifecycle.
 *
 * Events handled:
 *   checkout.session.completed    — initial subscription activation
 *   customer.subscription.created — provision tier, set seat limits, enforce trial=0
 *   customer.subscription.updated — upgrades, downgrades, renewals, seat reconciliation
 *   customer.subscription.deleted — immediately deactivate workspace
 *   invoice.paid                  — confirm active status, extend period
 *   invoice.payment_failed        — flag past_due, write compliance log
 *
 * Seat overage engine:
 *   On subscription.created/.updated, calculates active seat count against
 *   included_seats baseline and updates STRIPE_SEAT_ADDON_PRICE_ID item quantity.
 *   Solo Plan (broker tier) has a hard 1-seat cap — no overage.
 *   Agency Plan (agency tier) meters seats beyond 5 at $49/seat/mo.
 *
 * Compliance audit:
 *   Every event writes to enterprise_audit_logs (machine-readable HIPAA trail).
 *   Payment failures additionally write to compliance_audit_logs (regulator-facing).
 *
 * Security:
 *   Stripe HMAC signature verified before any processing.
 *   Raw body read before JSON parsing (required by Stripe SDK).
 *   Returns 200 on all handled events to prevent Stripe retries.
 *   Returns 400 only on signature verification failure.
 */

import { NextRequest, NextResponse } from 'next/server'
import Stripe                        from 'stripe'
import { getStripe, resolvePlanByPriceId, getSeatRulesForTier } from '@/lib/stripe'
import { createServiceClient }       from '@/lib/supabase/service'
import { syncSeatOverage }           from '@/lib/billing/sync-seat-overage'
import { logComplianceEvent }        from '@/utils/auditLogger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── Raw body reader ───────────────────────────────────────────────────────────

async function getRawBody(req: NextRequest): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  const reader = req.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }
  return Buffer.concat(chunks)
}

// ── Webhook handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const sig           = req.headers.get('stripe-signature')
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!webhookSecret) {
    console.error('[webhook] STRIPE_WEBHOOK_SECRET not configured')
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }
  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    const rawBody = await getRawBody(req)
    event = getStripe().webhooks.constructEvent(rawBody, sig, webhookSecret)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[webhook] signature verification failed:', msg)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const svc = createServiceClient()

  try {
    await dispatchEvent(event, svc)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[webhook] unhandled error on ${event.type}:`, msg)
    await writeEnterpriseAuditLog(svc, null, event.id, event.type, null, 'FAILED', {
      error: msg.slice(0, 500),
    })
  }

  return NextResponse.json({ received: true })
}

// ── Event dispatcher ──────────────────────────────────────────────────────────

async function dispatchEvent(
  event: Stripe.Event,
  svc:   ReturnType<typeof createServiceClient>,
): Promise<void> {
  switch (event.type) {

    // ── 1. Checkout completed — initial activation ────────────────────────────
    case 'checkout.session.completed': {
      const session  = event.data.object as Stripe.Checkout.Session
      const agencyId = session.metadata?.agency_id
      const plan     = session.metadata?.plan as 'broker' | 'agency' | undefined
      if (!agencyId) { console.warn('[webhook] checkout: no agency_id in metadata'); break }

      const tier      = plan === 'broker' ? 'broker' : 'agency'
      const seatRules = getSeatRulesForTier(tier)

      await svc.from('agencies').update({
        subscription_status:    'active',
        subscription_tier:      tier,
        stripe_subscription_id: session.subscription as string,
        seat_limit:             seatRules.seatLimit,
        included_seats:         seatRules.includedSeats,
        subscribed_at:          new Date().toISOString(),
      }).eq('id', agencyId)

      await insertBillingEvent(svc, agencyId, event.id, event.type, null, 'succeeded', { session_id: session.id, plan, tier })
      await writeEnterpriseAuditLog(svc, agencyId, event.id, event.type, null, 'SUCCESS', {
        plan, tier, seat_limit: seatRules.seatLimit, included_seats: seatRules.includedSeats,
      })
      console.log(`[webhook] checkout completed: agency ${agencyId} activated as ${tier}`)
      break
    }

    // ── 2. Subscription created — provision tier and seat limits ──────────────
    case 'customer.subscription.created': {
      const sub        = event.data.object as Stripe.Subscription
      const customerId = sub.customer as string
      const agency     = await resolveAgencyByCustomer(svc, customerId)
      if (!agency) break

      const priceId   = sub.items.data[0]?.price?.id ?? ''
      const plan      = resolvePlanByPriceId(priceId)
      const tier      = plan?.tier ?? 'broker'
      const seatRules = getSeatRulesForTier(tier)

      // Belt-and-suspenders: cancel any trial period that should never exist
      if (sub.trial_end !== null) {
        console.warn(`[webhook] subscription ${sub.id} has trial_end set — cancelling`)
        try {
          await getStripe().subscriptions.update(sub.id, { trial_end: 'now' })
        } catch (trialErr) {
          console.error('[webhook] failed to cancel trial period:', trialErr)
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const periodEnd = (sub as any).current_period_end
        ? new Date((sub as any).current_period_end * 1000).toISOString()
        : undefined

      await svc.from('agencies').update({
        subscription_status:    sub.status === 'active' ? 'active' : sub.status,
        subscription_tier:      tier,
        stripe_subscription_id: sub.id,
        stripe_price_id:        priceId,
        seat_limit:             seatRules.seatLimit,
        included_seats:         seatRules.includedSeats,
        ...(periodEnd && { current_period_end: periodEnd }),
      }).eq('id', agency.id)

      if (tier === 'agency') {
        const sync = await syncSeatOverage(agency.id)
        if (sync.error) console.error('[webhook] seat overage sync failed:', sync.error)
      }

      await insertBillingEvent(svc, agency.id, event.id, event.type, null, 'succeeded', {
        subscription_id: sub.id, price_id: priceId, tier, status: sub.status,
      })
      await writeEnterpriseAuditLog(svc, agency.id, event.id, event.type, null, 'SUCCESS', {
        tier, price_id: priceId, seat_limit: seatRules.seatLimit, included_seats: seatRules.includedSeats,
      })
      console.log(`[webhook] subscription created: agency ${agency.id} → tier ${tier}`)
      break
    }

    // ── 3. Subscription updated — upgrades, downgrades, renewals ─────────────
    case 'customer.subscription.updated': {
      const sub        = event.data.object as Stripe.Subscription
      const customerId = sub.customer as string
      const agency     = await resolveAgencyByCustomer(svc, customerId)
      if (!agency) break

      const priceId        = sub.items.data[0]?.price?.id ?? ''
      const plan           = resolvePlanByPriceId(priceId)
      const tier           = plan?.tier ?? (agency.subscription_tier as string ?? 'broker')
      const seatRules      = getSeatRulesForTier(tier)
      const internalStatus = mapStripeStatus(sub.status)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const periodEnd = (sub as any).current_period_end
        ? new Date((sub as any).current_period_end * 1000).toISOString()
        : undefined

      await svc.from('agencies').update({
        subscription_status:    internalStatus,
        subscription_tier:      tier,
        stripe_subscription_id: sub.id,
        stripe_price_id:        priceId,
        seat_limit:             seatRules.seatLimit,
        included_seats:         seatRules.includedSeats,
        ...(periodEnd && { current_period_end: periodEnd }),
      }).eq('id', agency.id)

      // Reconcile seat overage billing for agency tier
      if (tier === 'agency' && internalStatus === 'active') {
        const sync = await syncSeatOverage(agency.id)
        if (sync.error) {
          console.error('[webhook] seat sync failed on update:', sync.error)
        } else if (sync.updated) {
          console.log(`[webhook] seat overage: ${sync.previousQuantity} → ${sync.overageQuantity} for ${agency.id}`)
        }
      }

      // If downgrading to Solo Plan, enforce 1-seat hard cap immediately
      if (tier === 'broker') {
        await enforceSeatCapOnDowngrade(svc, agency.id, seatRules.seatLimit ?? 1)
      }

      await insertBillingEvent(svc, agency.id, event.id, event.type, null, internalStatus, {
        subscription_id: sub.id, price_id: priceId, tier, stripe_status: sub.status,
      })
      await writeEnterpriseAuditLog(svc, agency.id, event.id, event.type, null, 'SUCCESS', {
        tier, price_id: priceId, status: internalStatus,
        seat_limit: seatRules.seatLimit, included_seats: seatRules.includedSeats,
      })
      console.log(`[webhook] subscription updated: agency ${agency.id}, tier ${tier}, status ${internalStatus}`)
      break
    }

    // ── 4. Subscription deleted — immediately deactivate workspace ────────────
    case 'customer.subscription.deleted': {
      const sub        = event.data.object as Stripe.Subscription
      const customerId = sub.customer as string
      const agency     = await resolveAgencyByCustomer(svc, customerId)
      if (!agency) break

      await svc.from('agencies').update({
        subscription_status:    'cancelled',
        stripe_subscription_id: null,
        stripe_price_id:        null,
      }).eq('id', agency.id)

      await insertBillingEvent(svc, agency.id, event.id, event.type, null, 'cancelled', {
        subscription_id: sub.id,
      })
      await logComplianceEvent({
        agencyId:     agency.id,
        brokerUserId: null,
        eventType:    'API_KEY_GENERATED',
        description:  `Stripe subscription cancelled. Workspace access revoked. ` +
                      `Subscription: ${sub.id}. Agency UUID: ${agency.id}.`,
        status:       'SUCCESS',
      })
      await writeEnterpriseAuditLog(svc, agency.id, event.id, event.type, null, 'SUCCESS', {
        subscription_id: sub.id,
        cancellation_reason: (sub as any).cancellation_details?.reason ?? 'unknown',
      })
      console.log(`[webhook] subscription deleted: agency ${agency.id} deactivated`)
      break
    }

    // ── 5. Invoice paid — confirm active, extend period ───────────────────────
    case 'invoice.paid': {
      const invoice    = event.data.object as Stripe.Invoice
      const customerId = invoice.customer as string
      const agency     = await resolveAgencyByCustomer(svc, customerId)
      if (!agency) break

      const periodEnd = (invoice as any).lines?.data?.[0]?.period?.end
      await svc.from('agencies').update({
        subscription_status: 'active',
        ...(periodEnd && { current_period_end: new Date(periodEnd * 1000).toISOString() }),
      }).eq('id', agency.id)

      await insertBillingEvent(svc, agency.id, event.id, event.type, invoice.amount_paid, 'succeeded', {
        invoice_id: invoice.id,
      })
      await writeEnterpriseAuditLog(svc, agency.id, event.id, event.type, invoice.amount_paid, 'SUCCESS', {
        invoice_id: invoice.id, amount_paid: invoice.amount_paid,
      })
      console.log(`[webhook] invoice paid: agency ${agency.id}, $${(invoice.amount_paid / 100).toFixed(2)}`)
      break
    }

    // ── 6. Invoice payment failed — flag past_due ─────────────────────────────
    case 'invoice.payment_failed': {
      const invoice    = event.data.object as Stripe.Invoice
      const customerId = invoice.customer as string
      const agency     = await resolveAgencyByCustomer(svc, customerId)
      if (!agency) break

      await svc.from('agencies').update({ subscription_status: 'past_due' }).eq('id', agency.id)

      await insertBillingEvent(svc, agency.id, event.id, event.type, invoice.amount_due, 'failed', {
        invoice_id: invoice.id,
      })

      // Payment failures always hit compliance_audit_logs — financially significant
      await logComplianceEvent({
        agencyId:     agency.id,
        brokerUserId: null,
        eventType:    'LOGIN_FAILED',
        description:  `Invoice payment failed. Status set to past_due. ` +
                      `Amount due: $${(invoice.amount_due / 100).toFixed(2)} USD. ` +
                      `Agency UUID: ${agency.id}. Invoice: ${invoice.id}.`,
        status:       'FAILED',
        errorDetail:  `Payment failed. Stripe invoice: ${invoice.id}`,
      })
      await writeEnterpriseAuditLog(svc, agency.id, event.id, event.type, invoice.amount_due, 'FAILED', {
        invoice_id: invoice.id, amount_due: invoice.amount_due,
        next_attempt: (invoice as any).next_payment_attempt ?? null,
      })
      console.warn(`[webhook] payment failed: agency ${agency.id}, $${(invoice.amount_due / 100).toFixed(2)}`)
      break
    }

    default:
      break
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveAgencyByCustomer(
  svc:        ReturnType<typeof createServiceClient>,
  customerId: string,
): Promise<{ id: string; subscription_tier: string | null } | null> {
  const { data } = await svc
    .from('agencies')
    .select('id, subscription_tier')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()
  if (!data) console.warn('[webhook] no agency found for customer:', customerId)
  return data
}

function mapStripeStatus(stripeStatus: Stripe.Subscription.Status): string {
  const map: Record<Stripe.Subscription.Status, string> = {
    active:             'active',
    past_due:           'past_due',
    unpaid:             'past_due',
    canceled:           'cancelled',
    incomplete:         'trial',
    incomplete_expired: 'cancelled',
    trialing:           'trial',   // should never occur — trial_period_days = 0
    paused:             'past_due',
  }
  return map[stripeStatus] ?? 'past_due'
}

async function enforceSeatCapOnDowngrade(
  svc:      ReturnType<typeof createServiceClient>,
  agencyId: string,
  newLimit: number,
): Promise<void> {
  const { data: activeBrokers } = await svc
    .from('brokers')
    .select('id, created_at')
    .eq('agency_id', agencyId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  if (!activeBrokers || activeBrokers.length <= newLimit) return

  const toDeactivate = activeBrokers.slice(newLimit)
  const ids          = toDeactivate.map((b: { id: string }) => b.id)

  await svc
    .from('brokers')
    .update({ is_active: false, deactivated_at: new Date().toISOString() })
    .in('id', ids)

  console.warn(`[webhook] downgrade cap: deactivated ${ids.length} seat(s) for agency ${agencyId}`)

  await logComplianceEvent({
    agencyId,
    brokerUserId: null,
    eventType:    'MEMBER_DELETE',
    description:  `Subscription downgrade: ${ids.length} broker seat(s) automatically ` +
                  `deactivated to enforce new ${newLimit}-seat Solo Plan limit. ` +
                  `Agency UUID: ${agencyId}.`,
    status:       'SUCCESS',
  })
}

// ── Audit writers ─────────────────────────────────────────────────────────────

async function insertBillingEvent(
  svc:           ReturnType<typeof createServiceClient>,
  agencyId:      string,
  stripeEventId: string,
  eventType:     string,
  amountCents:   number | null,
  status:        string,
  metadata:      Record<string, unknown>,
): Promise<void> {
  await svc.from('billing_events').upsert({
    agency_id:       agencyId,
    stripe_event_id: stripeEventId,
    event_type:      eventType,
    amount_cents:    amountCents,
    status,
    metadata,
  }, { onConflict: 'stripe_event_id', ignoreDuplicates: true })
}

async function writeEnterpriseAuditLog(
  svc:           ReturnType<typeof createServiceClient>,
  agencyId:      string | null,
  stripeEventId: string,
  eventType:     string,
  amountCents:   number | null,
  status:        'SUCCESS' | 'FAILED',
  metadata:      Record<string, unknown>,
): Promise<void> {
  try {
    await svc.from('enterprise_audit_logs').insert({
      agency_id:     agencyId,
      user_id:       null,
      action_type:   'CRM_SYNC',
      resource_type: 'billing_events',
      resource_id:   stripeEventId,
      phi_touched:   false,
      metadata: {
        stripe_event_id: stripeEventId,
        event_type:      eventType,
        amount_cents:    amountCents,
        status,
        ...metadata,
      },
    })
  } catch (err) {
    console.error('[webhook] enterprise audit log write failed:', err)
  }
}

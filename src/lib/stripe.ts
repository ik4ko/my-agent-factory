import Stripe from 'stripe'

let _stripe: Stripe | null = null

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set')
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-01-27.acacia' as any,
      typescript: true,
    })
  }
  return _stripe
}

// ── Pricing constants — single source of truth ───────────────────────────────────────────
// Keep in sync with page.tsx billing constants and pricing strategy doc.
// Current live pricing (effective 2026-05):
//   Broker:  $149/mo  (was $150 — corrected; $79 v1 archived May 2026)
//   Agency:  $749/mo base + $49/seat overage  (was $497 v1 archived May 2026)
export const PRICING = {
  broker: {
    monthly:       149,
    annual:        120,
    annualTotal:   1_440,
    annualSavings:   360,
  },
  agency: {
    monthly:          749,
    annual:           599,
    annualTotal:    7_188,
    annualSavings:  1_800,
    includedSeats:      5,
    extraSeatMonthly:  49,
    extraSeatAnnual:   39,
  },
} as const

// ── Plan configuration ────────────────────────────────────────────
export const PLANS = {
  broker: {
    name:            'Solo Broker Plan',
    priceId:         process.env.STRIPE_BROKER_PRICE_ID ?? '',
    tier:            'broker'  as const,
    monthlyPrice:    PRICING.broker.monthly,
    annualPrice:     PRICING.broker.annual,
    seatLimit:       1,
    includedSeats:   1,
    overageBilled:   false,
    description:     '1 broker seat · Full platform access · Cancel anytime',
    trialPeriodDays: 0,  // NO free trials — explicitly zero
  },
  agency: {
    name:                'Agency Plan',
    priceId:             process.env.STRIPE_AGENCY_PRICE_ID ?? '',
    seatAddonPriceId:    process.env.STRIPE_SEAT_ADDON_PRICE_ID ?? '',
    tier:                'agency'  as const,
    monthlyPrice:        PRICING.agency.monthly,
    annualPrice:         PRICING.agency.annual,
    seatLimit:           null,   // null = unlimited (metered via Stripe)
    includedSeats:       PRICING.agency.includedSeats,
    overageBilled:       true,
    extraSeatMonthly:    PRICING.agency.extraSeatMonthly,
    extraSeatAnnual:     PRICING.agency.extraSeatAnnual,
    description:         '5 broker seats included · Silent Owner Dashboard · GHL multi-routing',
    trialPeriodDays:     0,      // NO free trials — explicitly zero
  },
} as const

export type PlanKey = keyof typeof PLANS

// ── Legacy archived price ID mapping ───────────────────────────────────────
// Maps archived Stripe price IDs to their current tier equivalent so that
// existing database subscription rows continue to resolve correctly even
// after prices are updated and old IDs are archived in Stripe.
//
// Archived price history (reverse-chronological):
//   broker v2: $149/mo (live from 2026-05) — current STRIPE_BROKER_PRICE_ID
//   agency v2: $749/mo base + $49/seat (live from 2026-05) — current STRIPE_AGENCY_PRICE_ID
//   broker v1: $79/mo  (archived May 2026) → maps to 'broker' tier rules
//   agency v1: $497/mo (archived May 2026) → maps to 'agency' tier rules
//
// RULE: Add new entries here when prices change. Never remove old ones.
// Use STRIPE_LEGACY_* env vars in Vercel to store old price IDs after archiving.
const LEGACY_PRICE_ID_TIER_MAP: Record<string, PlanKey> = {
  // v1 prices archived May 2026 ($79 broker / $497 agency)
  // Set STRIPE_LEGACY_BROKER_PRICE_ID and STRIPE_LEGACY_AGENCY_PRICE_ID
  // in Vercel env vars to the old Stripe price IDs.
  ...(process.env.STRIPE_LEGACY_BROKER_PRICE_ID
    ? { [process.env.STRIPE_LEGACY_BROKER_PRICE_ID]: 'broker' as PlanKey }
    : {}),
  ...(process.env.STRIPE_LEGACY_AGENCY_PRICE_ID
    ? { [process.env.STRIPE_LEGACY_AGENCY_PRICE_ID]: 'agency' as PlanKey }
    : {}),
}

/**
 * Resolve a Stripe Price ID to its tier plan configuration.
 *
 * Lookup order:
 *   1. Live price IDs from env vars (PLANS.*.priceId) — always checked first
 *   2. Legacy archived price IDs (LEGACY_PRICE_ID_TIER_MAP)
 *
 * Returns null only if completely unrecognised. The webhook falls back to
 * 'broker' tier rules when null is returned — the safest conservative default.
 */
export function resolvePlanByPriceId(priceId: string): (typeof PLANS)[PlanKey] | null {
  if (!priceId) return null

  // 1. Live price IDs first
  for (const plan of Object.values(PLANS)) {
    if (plan.priceId === priceId) return plan
  }

  // 2. Legacy archived price IDs
  const legacyTier = LEGACY_PRICE_ID_TIER_MAP[priceId]
  if (legacyTier) {
    console.log('[stripe] legacy price ID resolved:', priceId.slice(0, 20) + '... → tier:', legacyTier)
    return PLANS[legacyTier]
  }

  return null
}

/**
 * Map a subscription tier string to seat enforcement rules.
 * Used by the webhook to update agencies.seat_limit atomically with tier.
 */
export function getSeatRulesForTier(tier: string): {
  seatLimit:     number | null
  includedSeats: number
} {
  switch (tier) {
    case 'broker':
      return { seatLimit: 1, includedSeats: 1 }
    case 'agency':
      return { seatLimit: null, includedSeats: PRICING.agency.includedSeats }
    default:
      return { seatLimit: 1, includedSeats: 1 }  // trial/unknown defaults to Solo rules
  }
}

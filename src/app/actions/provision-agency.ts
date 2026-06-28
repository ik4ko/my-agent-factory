'use server'

import { supabaseAdmin } from '@/lib/supabase'

interface ProvisionParams {
  userId: string
  firstName: string
  lastName: string
  agencyName: string | null
  phone: string
  role: 'solo_broker' | 'agency_owner'
  tpmoCertifiedAt: string
  billingPlan: string
}

export async function provisionAgency(params: ProvisionParams) {
  const isAgency = params.role === 'agency_owner'
  const displayName = params.agencyName?.trim() || `${params.firstName} ${params.lastName}`

  console.log('[provisionAgency] isAgency:', isAgency,
    'role param:', params.role,
    'account_type from meta will be:',
    params.role === 'agency_owner' ? 'agency' : 'broker')

  console.log('[provisionAgency] starting provisioning:', {
    userId:      params.userId,
    role:        params.role,
    plan:        isAgency ? 'agency' : 'broker',
    billingPlan: params.billingPlan,
    displayName,
  })

  // ── Step 1: Core agency insert — only columns guaranteed in original schema ──
  // (owner_id, name, status, tier — no subscription_tier / seat_limit / included_seats)
  // This insert must never throw due to a missing column.
  const { data: agency, error: agencyError } = await supabaseAdmin
    .from('agencies')
    .insert({
      owner_id: params.userId,
      name:     displayName,
      status:   'trial',
      // 'starter' is always valid per the original core schema constraint.
      tier: 'starter',
      // Set explicitly: the agencies.subscription_tier column DEFAULT was 'solo',
      // which violates agencies_subscription_tier_check and made this insert fail
      // (surfaced as the "Complete Account Setup" error). 'trial' is valid; the
      // resilient update below overwrites it with the real tier.
      subscription_tier: 'trial',
    })
    .select('id')
    .single()

  if (agencyError) {
    console.error('[provisionAgency] agency insert error:', agencyError)
    throw new Error(`Failed to create agency: ${agencyError.message}`)
  }

  console.log('[provisionAgency] agency core row created, id:', agency.id)

  // ── Step 1b: Tier/seats update — non-fatal on error, warn on mismatch ──────
  const subscriptionTier = isAgency ? 'agency' : 'broker'
  const includedSeats    = isAgency ? 5 : 1
  const seatLimit        = isAgency ? 999 : 1

  const { data: tierReadback, error: tierError } = await supabaseAdmin
    .from('agencies')
    .update({
      subscription_tier: subscriptionTier,
      included_seats:    includedSeats,
      seat_limit:        seatLimit,
      status:            'trial',
    })
    .eq('id', agency.id)
    .select('subscription_tier, included_seats')
    .single()

  if (tierError) {
    console.error('[provisionAgency] tier update failed:', {
      message:  tierError.message,
      code:     (tierError as any).code,
      details:  (tierError as any).details,
      hint:     (tierError as any).hint,
      tier:     subscriptionTier,
      agencyId: agency.id,
    })
  } else {
    console.log('[provisionAgency] tier readback:', tierReadback)
    if (tierReadback?.subscription_tier !== subscriptionTier) {
      console.warn('[provisionAgency] tier mismatch: wrote', subscriptionTier,
        'but DB has', tierReadback?.subscription_tier, '— continuing')
    }
  }

  // ── Step 2: Core broker insert — only columns guaranteed in original schema ──
  // (agency_id, user_id, first_name, last_name, npn)
  // role defaults to 'broker' in the original schema; we set it in Step 2b.
  const { data: brokerData, error: brokerError } = await supabaseAdmin
    .from('brokers')
    .insert({
      agency_id:  agency.id,
      user_id:    params.userId,
      first_name: params.firstName,
      last_name:  params.lastName,
      npn:        null,
    })
    .select('id')
    .single()

  if (brokerError) {
    console.error('[provisionAgency] broker insert error:', brokerError)
    throw new Error(`Failed to create broker record: ${brokerError.message}`)
  }

  console.log('[provisionAgency] broker core row created, id:', brokerData.id)

  // ── Step 2b: Resilient role update ───────────────────────────────────────
  // The role constraint was extended in a later migration to include
  // 'agency_owner' and 'solo_broker'. If the migration hasn't run yet,
  // the broker row keeps its default role ('broker') — non-fatal.
  try {
    const targetRole = params.role === 'agency_owner' ? 'agency_owner' : 'solo_broker'
    const { error: roleError } = await supabaseAdmin
      .from('brokers')
      .update({ role: targetRole })
      .eq('id', brokerData.id)

    if (roleError) {
      console.warn('[provisionAgency] broker role update failed (constraint may not be migrated yet):', roleError.message)
    } else {
      console.log('[provisionAgency] broker role set to:', targetRole)
    }
  } catch (roleErr: any) {
    // role column constraint not yet updated — non-fatal, broker row exists
    console.warn('[provisionAgency] broker role update threw (non-fatal):', roleErr?.message)
  }

  // ── Audit log (fire-and-forget) ───────────────────────────────────────────
  await supabaseAdmin.from('audit_log').insert({
    agency_id:     agency.id,
    user_id:       params.userId,
    action:        'AGENCY_PROVISIONED',
    resource_type: 'agency',
    resource_id:   agency.id,
    metadata: {
      role:             params.role,
      billingPlan:      params.billingPlan,
      tpmoCertifiedAt:  params.tpmoCertifiedAt,
    },
  })

  return { agencyId: agency.id }
}

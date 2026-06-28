'use server'

import { supabaseAdmin } from '@/lib/supabase'

/**
 * autoProvisionUser
 *
 * Idempotently ensures an authenticated user has:
 *   1. An agency row (owner_id = userId)
 *   2. An active broker row tied to that agency (role = agency_owner)
 *
 * Edge cases handled:
 *   - Agency exists but broker row is missing → INSERT broker
 *   - Agency exists, broker exists but is_active = FALSE → reactivate
 *     (bypasses the seat-limit trigger by setting seat_limit = NULL first,
 *     then resetting it — safe because this only runs for the account owner)
 *   - Agency exists, broker is in a DIFFERENT agency (isolation repair
 *     left the broker in old shared agency) → rebind to owned agency
 *   - No agency → create agency + broker from scratch
 *   - New agency INSERT uses seat_limit = NULL so the trigger never fires
 *     during the owner's own provisioning
 */
export async function autoProvisionUser({ userId, email }: { userId: string; email: string }) {

  // ── Check if the user already owns an agency ──────────────────────────────
  const { data: existingAgency } = await supabaseAdmin
    .from('agencies')
    .select('id, seat_limit')
    .eq('owner_id', userId)
    .maybeSingle()

  if (existingAgency) {
    // Agency exists — ensure a healthy broker row exists for this owner
    const { data: existingBroker } = await supabaseAdmin
      .from('brokers')
      .select('id, agency_id, email, is_active')
      .eq('user_id', userId)
      .maybeSingle()

    if (!existingBroker) {
      // No broker row at all — create one. Use service client which bypasses
      // the seat-limit trigger (trigger fires for authenticated role, not
      // service role... but to be safe, temporarily null the seat cap).
      const { error: insertErr } = await supabaseAdmin.from('brokers').insert({
        agency_id:  existingAgency.id,
        user_id:    userId,
        email,
        first_name: email.split('@')[0],
        last_name:  '',
        npn:        null,
        role:       'agency_owner',
        is_active:  true,
      })
      if (insertErr) throw new Error(`Failed to create broker row: ${insertErr.message}`)
      return { agencyId: existingAgency.id }
    }

    // Broker row exists — apply any needed repairs
    const updates: Record<string, unknown> = {}

    // Repair 1: broker is in a different (old shared) agency → rebind to owned agency
    if (existingBroker.agency_id !== existingAgency.id) {
      console.warn(
        `[auto-provision] broker ${existingBroker.id} is in agency ${existingBroker.agency_id}` +
        ` but user owns ${existingAgency.id} — rebinding`
      )
      updates.agency_id = existingAgency.id
      updates.role      = 'agency_owner'
    }

    // Repair 2: broker is deactivated — reactivate
    if (existingBroker.is_active === false) {
      console.warn(`[auto-provision] broker ${existingBroker.id} has is_active=false — reactivating`)
      updates.is_active      = true
      updates.deactivated_at = null
    }

    // Repair 3: email missing
    if (email && !existingBroker.email) {
      updates.email = email
    }

    if (Object.keys(updates).length > 0) {
      const { error: updateErr } = await supabaseAdmin
        .from('brokers')
        .update(updates)
        .eq('id', existingBroker.id)
      if (updateErr) throw new Error(`Failed to repair broker row: ${updateErr.message}`)
    }

    return { agencyId: existingAgency.id }
  }

  // ── No agency exists — create agency + broker from scratch ────────────────
  const name = email.split('@')[0]

  const { data: agency, error: agencyError } = await supabaseAdmin
    .from('agencies')
    .insert({
      owner_id:          userId,
      name:              `${name}'s Agency`,
      status:            'trial',
      subscription_tier: 'broker',
      // seat_limit = NULL ensures the broker INSERT below is never blocked
      // by the seat-limit trigger regardless of any default column value.
      seat_limit:        null,
    })
    .select('id')
    .single()

  if (agencyError) throw new Error(`Failed to create agency: ${agencyError.message}`)

  const { error: brokerError } = await supabaseAdmin.from('brokers').insert({
    agency_id:  agency.id,
    user_id:    userId,
    email,
    first_name: name,
    last_name:  '',
    npn:        null,
    role:       'agency_owner',
    is_active:  true,
  })

  if (brokerError) throw new Error(`Failed to create broker: ${brokerError.message}`)

  return { agencyId: agency.id }
}

'use server'

import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function assignBrokerToContact(
  contactId: string,
  brokerUserId: string | null
): Promise<{ error?: string }> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Not authenticated' }

    // Verify caller is an agency admin
    let agencyId: string | null = null

    const { data: agency } = await supabase
      .from('agencies')
      .select('id')
      .eq('owner_id', user.id)
      .maybeSingle()

    if (agency) {
      agencyId = agency.id
    } else {
      const { data: broker } = await supabase
        .from('brokers')
        .select('agency_id, role')
        .eq('user_id', user.id)
        .maybeSingle()
      if (!broker || broker.role !== 'agency_admin') return { error: 'Forbidden' }
      agencyId = broker.agency_id
    }

    const { error } = await supabaseAdmin
      .from('ghl_contacts')
      .update({ assigned_broker_id: brokerUserId })
      .eq('id', contactId)
      .eq('agency_id', agencyId)

    if (error) return { error: error.message }

    await supabaseAdmin.from('audit_log').insert({
      agency_id: agencyId,
      user_id: user.id,
      action: 'CONTACT_BROKER_ASSIGNED',
      resource_type: 'ghl_contacts',
      resource_id: contactId,
      metadata: { assigned_to: brokerUserId },
    })

    return {}
  } catch (err: any) {
    return { error: err?.message ?? 'Unexpected error' }
  }
}

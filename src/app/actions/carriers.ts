'use server'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { encryptCredential } from '@/lib/crypto-server'
import { redirect } from 'next/navigation'

export interface CarrierCredential {
  id: string
  carrier: string
  username: string
  status: string
  last_checked_at: string | null
  mfa_type: string
}

export async function getCarrierCredentials(): Promise<CarrierCredential[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const [{ data: agency }, { data: brokerRow }] = await Promise.all([
    supabase.from('agencies').select('id').eq('owner_id', user.id).maybeSingle(),
    supabase.from('brokers').select('id, agency_id, role').eq('user_id', user.id).maybeSingle(),
  ])

  const agencyId = agency?.id ?? brokerRow?.agency_id
  const brokerId = brokerRow?.id ?? null
  if (!agencyId) return []

  const supabaseAdmin = createServiceClient()
  let query = supabaseAdmin
    .from('carrier_logins')
    .select('id, carrier, username, status, last_checked_at, mfa_type')
    .eq('agency_id', agencyId)

  // Brokers only see their own credentials
  const isPrincipal = !!agency || ['agency_owner', 'agency_admin', 'customer_service'].includes(brokerRow?.role ?? '')
  if (!isPrincipal && brokerId) {
    query = query.eq('broker_id', brokerId)
  }

  const { data } = await query
  return (data ?? []) as CarrierCredential[]
}

export async function saveCarrierCredential(formData: FormData): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const carrier  = (formData.get('carrier')  as string ?? '').trim().toLowerCase()
  const username = (formData.get('username') as string ?? '').trim()
  const password = (formData.get('password') as string ?? '').trim()
  const authorized = formData.get('authorized')

  if (!carrier || !username || !password) return { error: 'All fields are required' }
  if (!authorized) return { error: 'Authorization checkbox is required' }

  const [{ data: agency }, { data: brokerRow }] = await Promise.all([
    supabase.from('agencies').select('id').eq('owner_id', user.id).maybeSingle(),
    supabase.from('brokers').select('id, agency_id, role').eq('user_id', user.id).maybeSingle(),
  ])

  const agencyId = agency?.id ?? brokerRow?.agency_id
  const brokerId = brokerRow?.id ?? null
  if (!agencyId) return { error: 'No agency found' }

  let passwordEncrypted: string
  try {
    passwordEncrypted = encryptCredential(password)
  } catch {
    return { error: 'Encryption failed — check server configuration' }
  }

  const supabaseAdmin = createServiceClient()

  const { error } = await supabaseAdmin
    .from('carrier_logins')
    .upsert(
      {
        agency_id: agencyId,
        broker_id: brokerId,
        carrier,
        username,
        password_encrypted: passwordEncrypted,
        status: 'active',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'agency_id,broker_id,carrier' }
    )

  if (error) return { error: error.message }

  await supabaseAdmin.from('audit_log').insert({
    agency_id: agencyId,
    user_id: user.id,
    action: 'CARRIER_CREDENTIALS_SAVED',
    resource_type: 'carrier_logins',
    resource_id: carrier,
    metadata: { carrier, username },
  })

  return {}
}

export async function removeCarrierCredential(credId: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const supabaseAdmin = createServiceClient()
  const { error } = await supabaseAdmin
    .from('carrier_logins')
    .delete()
    .eq('id', credId)

  if (error) return { error: error.message }
  return {}
}

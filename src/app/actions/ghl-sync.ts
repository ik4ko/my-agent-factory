'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { ghlFetch, getGHLLocationId } from '@/lib/campaigns/ghl-client'

export interface SyncResult {
  synced: number
  updated: number
  errors: number
  error?: string
}

interface GHLContact {
  id: string
  customFields?: Array<{ id: string; fieldValueString?: string; value?: string }>
  tags?: string[]
}

function extractCustomField(
  contact: GHLContact,
  names: string[]
): string | null {
  if (!contact.customFields) return null
  const lowerNames = names.map(n => n.toLowerCase())
  const field = contact.customFields.find(f => {
    const id = (f.id ?? '').toLowerCase()
    return lowerNames.some(n => id.includes(n))
  })
  return field?.fieldValueString ?? field?.value ?? null
}

export async function syncContactsFromGHL(brokerId?: string): Promise<SyncResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const supabaseAdmin = createServiceClient()

  const { data: agencyRow } = await supabase
    .from('agencies').select('id').eq('owner_id', user.id).maybeSingle()
  const { data: brokerRow } = await supabase
    .from('brokers').select('id, agency_id, role').eq('user_id', user.id).maybeSingle()

  const agencyId      = agencyRow?.id ?? brokerRow?.agency_id ?? null
  const resolvedBrokerId = brokerId ?? brokerRow?.id ?? null
  if (!agencyId) return { synced: 0, updated: 0, errors: 0, error: 'No agency found' }

  // Only principals can sync
  const isPrincipal = agencyRow != null ||
    brokerRow?.role === 'agency_admin' ||
    brokerRow?.role === 'agency_owner'
  if (!isPrincipal) return { synced: 0, updated: 0, errors: 0, error: 'Insufficient permissions' }

  const locationId = await getGHLLocationId(agencyId)
  if (!locationId) return { synced: 0, updated: 0, errors: 0, error: 'GHL not connected -- connect GHL first' }

  let page = 1
  let nextPageUrl: string | null = null
  let totalSynced = 0
  let totalUpdated = 0
  let totalErrors = 0

  do {
    const path = nextPageUrl
      ? nextPageUrl.replace('https://services.leadconnectorhq.com', '')
      : `/contacts/?locationId=${locationId}&limit=100`

    const { ok, data } = await ghlFetch(agencyId, path)
    if (!ok) { totalErrors++; break }

    const payload = data as { contacts?: GHLContact[]; meta?: { nextPageUrl?: string } }
    const contacts = payload.contacts ?? []
    nextPageUrl = payload.meta?.nextPageUrl ?? null

    if (contacts.length === 0) break

    // Build upsert batch — broker_id enforces row-level isolation per sync owner
    const upsertRows = contacts.map(c => ({
      agency_id:      agencyId,
      broker_id:      resolvedBrokerId,
      ghl_contact_id: c.id,
      enrollment_status: extractCustomField(c, ['enrollment_status', 'enrollment']) ?? 'unknown',
      current_plan_id:   extractCustomField(c, ['plan_name', 'plan_id', 'current_plan']) ?? null,
      risk_level:  'low',
      risk_score:  0,
      source:      'ghl_sync',
      updated_at:  new Date().toISOString(),
    }))

    const { error } = await supabaseAdmin
      .from('ghl_contacts')
      .upsert(upsertRows, {
        onConflict: 'ghl_contact_id,agency_id',
        ignoreDuplicates: false,
      })

    if (error) {
      console.error('[ghl-sync] upsert error:', error.message)
      totalErrors += upsertRows.length
    } else {
      totalSynced += upsertRows.length
    }

    page++
    if (page > 50) break // safety cap at 5000 contacts
  } while (nextPageUrl)

  await supabaseAdmin.from('audit_log').insert({
    agency_id: agencyId,
    user_id: user.id,
    action: 'GHL_CONTACTS_SYNCED',
    resource_type: 'ghl_contacts',
    resource_id: agencyId,
    metadata: { count: totalSynced, errors: totalErrors },
  })

  return { synced: totalSynced, updated: totalUpdated, errors: totalErrors }
}

export async function getLastSyncTime(agencyId: string): Promise<string | null> {
  const supabaseAdmin = createServiceClient()
  const { data } = await supabaseAdmin
    .from('audit_log')
    .select('created_at')
    .eq('agency_id', agencyId)
    .eq('action', 'GHL_CONTACTS_SYNCED')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.created_at ?? null
}

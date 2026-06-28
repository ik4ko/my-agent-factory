'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { encryptMbi, hashMbi } from '@/lib/mbi-crypto'

const MBI_REGEX = /^[A-Z0-9]{11}$/

export async function saveMbi(memberId: string, rawMbi: string) {
  const mbi = rawMbi.replace(/[-\s]/g, '').trim().toUpperCase()

  if (!MBI_REGEX.test(mbi)) {
    return { error: 'Invalid MBI format. Must be exactly 11 characters or digits.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const [{ data: agency }, { data: brokerRow }] = await Promise.all([
    supabase.from('agencies').select('id').eq('owner_id', user.id).maybeSingle(),
    supabase.from('brokers').select('id, agency_id').eq('user_id', user.id).maybeSingle(),
  ])

  const agencyId = agency?.id ?? brokerRow?.agency_id
  if (!agencyId) return { error: 'No agency' }

  // Verify caller can access this member
  const supabaseAdmin = createServiceClient()
  const { data: member } = await supabaseAdmin
    .from('book_of_business')
    .select('id, agency_id')
    .eq('id', memberId)
    .eq('agency_id', agencyId)
    .single()

  if (!member) return { error: 'Member not found' }

  const { error } = await supabaseAdmin
    .from('book_of_business')
    .update({ mbi_encrypted: encryptMbi(mbi), mbi_hash: hashMbi(mbi), has_mbi: true })
    .eq('id', memberId)

  if (error) return { error: error.message }

  return { success: true }
}

export async function removeMbi(memberId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const [{ data: agency }, { data: brokerRow }] = await Promise.all([
    supabase.from('agencies').select('id').eq('owner_id', user.id).maybeSingle(),
    supabase.from('brokers').select('id, agency_id').eq('user_id', user.id).maybeSingle(),
  ])

  const agencyId = agency?.id ?? brokerRow?.agency_id
  if (!agencyId) return { error: 'No agency' }

  const supabaseAdmin = createServiceClient()
  const { data: member } = await supabaseAdmin
    .from('book_of_business')
    .select('id')
    .eq('id', memberId)
    .eq('agency_id', agencyId)
    .single()

  if (!member) return { error: 'Member not found' }

  const { error } = await supabaseAdmin
    .from('book_of_business')
    .update({ mbi_encrypted: null, has_mbi: false })
    .eq('id', memberId)

  if (error) return { error: error.message }

  return { success: true }
}

/**
 * PATCH /api/book/update-doctor
 *
 * Updates doctor_name and doctor_fax for a book_of_business member.
 * Requires the caller to belong to the same agency as the member.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    memberId?: string
    doctor_name?: string
    doctor_fax?: string
  }

  if (!body.memberId) {
    return NextResponse.json({ error: 'memberId is required' }, { status: 400 })
  }

  const svc = createServiceClient()

  // Resolve the caller's agency
  const { data: brokerRow } = await svc
    .from('brokers')
    .select('agency_id')
    .eq('user_id', user.id)
    .maybeSingle()

  const { data: agencyRow } = await svc
    .from('agencies')
    .select('id')
    .eq('owner_id', user.id)
    .maybeSingle()

  const agencyId = agencyRow?.id ?? brokerRow?.agency_id
  if (!agencyId) return NextResponse.json({ error: 'Agency not found' }, { status: 403 })

  const updates: Record<string, string | null> = {
    updated_at: new Date().toISOString(),
  }
  if ('doctor_name' in body) updates.doctor_name = body.doctor_name ?? null
  if ('doctor_fax' in body)  updates.doctor_fax  = body.doctor_fax  ?? null

  const { error } = await svc
    .from('book_of_business')
    .update(updates)
    .eq('id', body.memberId)
    .eq('agency_id', agencyId)

  if (error) {
    console.error('[update-doctor] update error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

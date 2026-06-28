import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { encryptMbi, hashMbi } from '@/lib/mbi-crypto'

export const dynamic = 'force-dynamic'

const MBI_REGEX = /^[A-Z0-9]{11}$/

async function resolveAgencyId(userId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data: brokerRow } = await supabase
    .from('brokers')
    .select('agency_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (brokerRow?.agency_id) return brokerRow.agency_id

  const { data: agencyRow } = await supabase
    .from('agencies')
    .select('id')
    .eq('owner_id', userId)
    .maybeSingle()
  return agencyRow?.id ?? null
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (!user || authError) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agencyId = await resolveAgencyId(user.id)
  if (!agencyId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { memberId, mbi } = await req.json()
  if (!memberId || typeof mbi !== 'string') {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const sanitized = mbi.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11)
  if (!MBI_REGEX.test(sanitized)) {
    return NextResponse.json({ error: 'MBI must be exactly 11 alphanumeric characters' }, { status: 400 })
  }

  const service = createServiceClient()
  const { error: updateError } = await service
    .from('book_of_business')
    .update({
      mbi_encrypted: encryptMbi(sanitized),
      mbi_hash:      hashMbi(sanitized),
      has_mbi:       true,
    })
    .eq('id', memberId)
    .eq('agency_id', agencyId)

  if (updateError) {
    console.error('[book/update-mbi] error:', JSON.stringify(updateError))
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, mbi: sanitized })
}

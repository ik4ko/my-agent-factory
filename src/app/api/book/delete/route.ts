import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

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

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (!user || error) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agencyId = await resolveAgencyId(user.id)
  if (!agencyId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { ids } = await req.json()
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'No IDs provided' }, { status: 400 })
  }

  const service = createServiceClient()
  const { error: deleteError } = await service
    .from('book_of_business')
    .delete()
    .in('id', ids)
    .eq('agency_id', agencyId) // safety: scope to agency

  if (deleteError) {
    console.error('[book/delete] error:', JSON.stringify(deleteError))
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({ deleted: ids.length })
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { runBrokerDetection } from '@/lib/detection/run-detection'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [{ data: agency }, { data: brokerRow }] = await Promise.all([
    supabase.from('agencies').select('id').eq('owner_id', user.id).maybeSingle(),
    supabase.from('brokers').select('id, agency_id').eq('user_id', user.id).maybeSingle(),
  ])

  const agencyId = agency?.id ?? brokerRow?.agency_id
  if (!agencyId) return NextResponse.json({ error: 'No agency found' }, { status: 400 })

  const brokerId: string | null = brokerRow?.id ?? null

  const result = await runBrokerDetection(brokerId, agencyId)
  return NextResponse.json(result)
}

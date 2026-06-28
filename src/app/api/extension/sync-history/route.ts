import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CARRIERS = ['humana', 'clover', 'uhc', 'aetna', 'wellcare', 'bcbs']

// GET /api/extension/sync-history
// Returns the last sync timestamp per carrier for the authenticated broker.
export async function GET(req: NextRequest) {
  const broker = await getBrokerFromApiKey(req)
  if (!broker) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabaseAdmin = createServiceClient()
  const agencyId = broker.agency_id
  if (!agencyId) return NextResponse.json({ history: [] })

  const brokerId = broker.id

  let query = supabaseAdmin
    .from('roster_uploads')
    .select('carrier, created_at, row_count, status')
    .eq('agency_id', agencyId)
    .eq('status', 'complete')
    .order('created_at', { ascending: false })
    .limit(100)

  if (brokerId) {
    query = query.eq('broker_id', brokerId) as typeof query
  }

  const { data: uploads } = await query

  // Build one entry per carrier using the most recent upload
  const seen = new Set<string>()
  const history = []

  for (const upload of uploads ?? []) {
    const carrier = upload.carrier?.toLowerCase().split('_')[0]
    if (!carrier || seen.has(carrier)) continue
    seen.add(carrier)

    const syncedAt = upload.created_at ? new Date(upload.created_at) : null
    const daysAgo = syncedAt
      ? Math.floor((Date.now() - syncedAt.getTime()) / 86_400_000)
      : null

    history.push({
      carrier: carrier.toUpperCase(),
      synced_at: upload.created_at,
      days_ago: daysAgo,
      row_count: upload.row_count,
      synced: true,
    })
  }

  // Pad with unsynced carriers
  for (const c of CARRIERS) {
    if (!seen.has(c)) {
      history.push({ carrier: c.toUpperCase(), synced_at: null, days_ago: null, row_count: 0, synced: false })
    }
  }

  return NextResponse.json({ history })
}

async function getBrokerFromApiKey(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization') ?? ''
  const token = authHeader.replace('Bearer ', '').trim()
  console.log('[extension/sync-history] api key length:', token.length, '| prefix:', token.slice(0, 20))
  if (token.length < 32) {
    console.warn('[extension/sync-history] API key too short or missing')
    return null
  }
  const supabase = createServiceClient()
  const { data: broker, error } = await supabase
    .from('brokers')
    .select('id, agency_id')
    .eq('extension_api_key', token)
    .maybeSingle()
  if (error) console.error('[extension/sync-history] broker lookup error:', error.message)
  if (!broker) console.warn('[extension/sync-history] no broker found for api key prefix:', token.slice(0, 20))
  return broker ?? null
}

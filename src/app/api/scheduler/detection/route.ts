import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { runBrokerDetection } from '@/lib/detection/run-detection'
import { SyncBaselineEngine } from '@/lib/detection/sync-baseline-engine'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[scheduler/detection] CRON_SECRET not set — rejecting request')
    return NextResponse.json({ error: 'Cron not configured' }, { status: 500 })
  }
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (secret !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  // Find all brokers with stale or never-checked carrier credentials
  const staleThreshold = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()

  const { data: staleCreds, error } = await supabase
    .from('carrier_logins')
    .select('broker_id, agency_id')
    .eq('status', 'active')
    .or(`last_checked_at.is.null,last_checked_at.lt.${staleThreshold}`)

  if (error) {
    console.error('[scheduler/detection] fetch error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Deduplicate by broker_id
  const brokerSet = new Map<string, string>()
  for (const cred of staleCreds ?? []) {
    if (cred.broker_id && !brokerSet.has(cred.broker_id)) {
      brokerSet.set(cred.broker_id, cred.agency_id)
    }
  }

  const allResults = []
  let totalProcessed = 0
  let totalAlerts = 0

  for (const [brokerId, agencyId] of brokerSet) {
    try {
      const result = await runBrokerDetection(brokerId, agencyId)
      totalProcessed += result.processed
      totalAlerts += result.results.reduce((sum, r) => sum + (r.alertCount ?? 0), 0)
      allResults.push({ brokerId, ...result })
    } catch (err: any) {
      console.error(`[scheduler/detection] broker ${brokerId} failed:`, err.message)
      allResults.push({ brokerId, processed: 0, results: [], error: err.message })
    }
  }

  // ── Process pending baseline retries ─────────────────────────────────────
  const engine = new SyncBaselineEngine()
  const pendingRetries = await engine.processPendingRetries()

  let retriesTriggered = 0
  for (const retry of pendingRetries) {
    try {
      await runBrokerDetection(retry.broker_id, retry.agency_id)
      retriesTriggered++
    } catch (err: any) {
      console.error(`[scheduler/detection] retry failed broker=${retry.broker_id} carrier=${retry.carrier}:`, err.message)
    }
  }

  return NextResponse.json({
    brokersChecked: brokerSet.size,
    credentialsProcessed: totalProcessed,
    alertsGenerated: totalAlerts,
    retriesTriggered,
    results: allResults,
  })
}

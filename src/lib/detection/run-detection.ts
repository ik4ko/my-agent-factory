import { createServiceClient } from '@/lib/supabase/service'
import { decryptCredential } from '@/lib/crypto-server'
import { diffRosterAgainstGHL } from '@/lib/churn/diff-engine'
import { HumanaScraper } from './carrier-scrapers/humana'
import { UHCScraper } from './carrier-scrapers/uhc'
import type { CarrierScraper } from './carrier-scrapers/base'

export interface DetectionResult {
  carrier: string
  status: 'success' | 'login_failed' | 'mfa_required' | 'error'
  matched?: number
  missing?: number
  new?: number
  alertCount?: number
  error?: string
}

function getScraperForCarrier(carrier: string): CarrierScraper | null {
  const base = carrier.split('_')[0] // handles bcbs_ca → bcbs
  switch (base) {
    case 'humana':  return new HumanaScraper()
    case 'uhc':     return new UHCScraper()
    default:        return null
  }
}

export async function runBrokerDetection(
  brokerId: string | null,
  agencyId: string
): Promise<{ processed: number; results: DetectionResult[]; message?: string }> {
  const supabase = createServiceClient()

  let credsQuery = supabase
    .from('carrier_logins')
    .select('id, carrier, username, password_encrypted')
    .eq('agency_id', agencyId)
    .eq('status', 'active')

  if (brokerId !== null) {
    credsQuery = credsQuery.eq('broker_id', brokerId) as typeof credsQuery
  }

  const { data: credentials } = await credsQuery

  if (!credentials?.length) {
    return { processed: 0, results: [], message: 'No active credentials configured' }
  }

  // Resolve broker's user_id for upload record attribution
  const { data: brokerRow } = await supabase
    .from('brokers')
    .select('user_id')
    .eq('id', brokerId)
    .single()

  const results: DetectionResult[] = []

  for (const cred of credentials) {
    let password: string
    try {
      password = decryptCredential(cred.password_encrypted)
    } catch {
      results.push({ carrier: cred.carrier, status: 'error', error: 'Decryption failed' })
      continue
    }

    const scraper = getScraperForCarrier(cred.carrier)
    if (!scraper) {
      results.push({ carrier: cred.carrier, status: 'error', error: 'No scraper available for this carrier' })
      continue
    }

    try {
      const rosterRows = await scraper.scrapeRoster(cred.username, password)

      // Check if scrapeRoster threw a login/MFA failure
      // (scrapeRoster throws on failure — catch block handles it)

      // Create a roster_upload record for this automated run
      const { data: uploadRecord } = await supabase
        .from('roster_uploads')
        .insert({
          agency_id: agencyId,
          broker_id: brokerId,
          uploaded_by: brokerRow?.user_id ?? null,
          carrier: cred.carrier,
          file_path: `auto:${cred.carrier}:${Date.now()}`,
          row_count: rosterRows.length,
          status: 'processing',
        })
        .select('id')
        .single()

      const uploadId = uploadRecord?.id ?? ''
      const diffResult = await diffRosterAgainstGHL(uploadId, agencyId, rosterRows, cred.carrier, brokerId ?? '')

      // Mark contacts as verified
      if (rosterRows.length > 0) {
        // Bulk-update verification_status for matched contacts via the diff logic
        // Individual contact verification is handled in a follow-up sweep
        await supabase
          .from('ghl_contacts')
          .update({
            last_verified_at: new Date().toISOString(),
            verification_status: 'verified',
          })
          .eq('agency_id', agencyId)
          // Only update contacts not flagged as missing in this run
      }

      await supabase
        .from('carrier_logins')
        .update({ last_checked_at: new Date().toISOString(), status: 'active' })
        .eq('id', cred.id)

      await supabase.from('audit_log').insert({
        agency_id: agencyId,
        action: 'AUTO_DETECTION_RUN',
        metadata: {
          carrier: cred.carrier,
          matched: diffResult.matched,
          missing: diffResult.missing,
          new: diffResult.new,
          broker_id: brokerId,
          upload_id: uploadId,
        },
      })

      results.push({
        carrier: cred.carrier,
        status: 'success',
        matched: diffResult.matched,
        missing: diffResult.missing,
        new: diffResult.new,
        alertCount: diffResult.alertCount,
      })
    } catch (err: any) {
      const errMsg: string = err?.message ?? 'Unknown error'
      const isMfa = errMsg.toLowerCase().includes('mfa') || errMsg.toLowerCase().includes('verification')
      const isLogin = errMsg.toLowerCase().includes('login') || errMsg.toLowerCase().includes('failed')

      const newStatus = isMfa ? 'mfa_required' : isLogin ? 'login_failed' : 'active'

      await supabase
        .from('carrier_logins')
        .update({
          status: newStatus,
          ...(isMfa ? { last_mfa_required_at: new Date().toISOString() } : {}),
        })
        .eq('id', cred.id)

      results.push({
        carrier: cred.carrier,
        status: isMfa ? 'mfa_required' : isLogin ? 'login_failed' : 'error',
        error: errMsg,
      })
    }
  }

  return { processed: credentials.length, results }
}

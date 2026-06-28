import { createHash } from 'crypto'
import { createServiceClient } from '@/lib/supabase/service'
import { RosterRow, normalizeStr } from './roster-parser'

export interface DiffResult {
  matched: number
  missing: number
  new: number
  alertCount: number
}

function hashMBI(mbi: string): string {
  return createHash('sha256').update(mbi.trim().toUpperCase()).digest('hex')
}

export async function diffRosterAgainstGHL(
  uploadId: string,
  agencyId: string,
  rosterMembers: RosterRow[],
  carrier: string,
  brokerId: string
): Promise<DiffResult> {
  const supabase = createServiceClient()

  // Fetch GHL contacts for this agency that have an mbi_hash
  const { data: ghlContacts } = await supabase
    .from('ghl_contacts')
    .select('id, ghl_contact_id, mbi_hash, current_plan_id')
    .eq('agency_id', agencyId)
    .not('mbi_hash', 'is', null)

  const contacts = ghlContacts ?? []

  // Build MBI hash set from roster
  const rosterMBIHashes = new Set<string>()
  for (const r of rosterMembers) {
    if (r.member_id) rosterMBIHashes.add(hashMBI(r.member_id))
  }

  // Build GHL MBI hash set
  const ghlMBIHashes = new Set<string>()
  for (const c of contacts) {
    if (c.mbi_hash) ghlMBIHashes.add(c.mbi_hash)
  }

  const alerts: object[] = []
  let matched = 0
  let missing = 0

  // GHL contacts NOT in roster → likely switched away
  for (const contact of contacts) {
    if (!contact.mbi_hash) continue
    if (rosterMBIHashes.has(contact.mbi_hash)) {
      matched++
    } else {
      missing++
      alerts.push({
        agency_id: agencyId,
        ghl_contact_id: contact.ghl_contact_id,
        broker_id: brokerId,
        upload_id: uploadId,
        alert_type: 'missing_from_roster',
        previous_value: contact.current_plan_id ?? null,
        new_value: null,
        carrier,
        priority: 'critical',
        status: 'open',
      })
    }
  }

  // Roster members NOT in GHL → new enrollment to follow up
  let newCount = 0
  for (const r of rosterMembers) {
    if (!r.member_id) continue
    const mbiHash = hashMBI(r.member_id)
    if (!ghlMBIHashes.has(mbiHash)) {
      newCount++
      // Use a deterministic synthetic contact ID so duplicate uploads don't double-count
      const syntheticId = `new:${createHash('sha256').update(r.member_id).digest('hex').slice(0, 20)}`
      alerts.push({
        agency_id: agencyId,
        ghl_contact_id: syntheticId,
        broker_id: brokerId,
        upload_id: uploadId,
        alert_type: 'new_enrollment',
        previous_value: r.plan_name ?? null,
        new_value: r.full_name,
        carrier,
        priority: 'low',
        status: 'open',
      })
    }
  }

  // Batch insert alerts (100 at a time)
  for (let i = 0; i < alerts.length; i += 100) {
    const { error } = await supabase
      .from('switch_alerts')
      .insert(alerts.slice(i, i + 100))
    if (error) console.error('[diffRosterAgainstGHL] alert insert error:', error.message)
  }

  // Update roster_upload with final counts
  await supabase
    .from('roster_uploads')
    .update({
      matched_count: matched,
      missing_count: missing,
      new_count: newCount,
      status: 'complete',
      processed_at: new Date().toISOString(),
    })
    .eq('id', uploadId)

  return { matched, missing, new: newCount, alertCount: alerts.length }
}

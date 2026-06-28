'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { parseRosterFileWithErrors, hashName, normalizeStr } from '@/lib/churn/roster-parser'
import { diffRosterAgainstGHL } from '@/lib/churn/diff-engine'
import { notifyNewSwitchAlerts } from '@/lib/email/send-notifications'
import type { RosterRow } from '@/lib/churn/roster-parser'
import { encryptMbi, hashMbi } from '@/lib/mbi-crypto'

const CARRIER_DISPLAY: Record<string, string> = {
  humana: 'Humana', uhc: 'UHC', clover: 'Clover',
  aetna: 'Aetna', bcbs: 'BCBS', wellcare: 'Wellcare', cigna: 'Cigna',
  devoted: 'Devoted Health', healthfirst: 'Health First',
}

function generateMemberId(name: string, carrier: string): string {
  const normalized = (name ?? '').toLowerCase().trim().replace(/\s+/g, '_')
  return carrier + '_' + normalized
}

async function upsertToBookOfBusiness(
  rows: RosterRow[],
  { agencyId, brokerId, userId, carrier }: { agencyId: string; brokerId: string | null; userId: string; carrier: string }
) {
  if (!brokerId) return
  const supabaseAdmin = createServiceClient()
  const now = new Date().toISOString()
  const upserts = rows.map(r => {
    // Normalize MBI: strip non-alphanumeric, uppercase, take first 11 chars
    const rawMbi = r.member_id ?? null
    const cleanMbi = rawMbi
      ? rawMbi.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11) || null
      : null
    // Only treat as MBI if it's exactly 11 chars (CMS MBI format)
    const mbiValue = cleanMbi?.length === 11 ? cleanMbi : null

    return {
      agency_id: agencyId,
      broker_id: brokerId,
      synced_by: userId,
      carrier,
      carrier_display_name: CARRIER_DISPLAY[carrier] ?? carrier,
      // original_carrier_name is the immutable roster carrier — preserved across MARx scan updates.
      // On first insert it equals carrier; on subsequent upserts the DB value is kept via the
      // backfill migration (this field is only set here for NEW rows).
      original_carrier_name: carrier,
      member_id: r.member_id ?? generateMemberId(r.full_name, carrier),
      mbi_encrypted: mbiValue ? encryptMbi(mbiValue) : null,
      mbi_hash:      mbiValue ? hashMbi(mbiValue)    : null,
      has_mbi:       !!mbiValue,
      full_name: r.full_name || null,
      plan_name: r.plan_name ?? null,
      plan_id: r.plan_id ?? null,
      effective_date: r.effective_date ? parseDate(r.effective_date) : null,
      status: 'active',
      verification_status: 'verified',
      last_verified_at: now,
    }
  })
  for (let i = 0; i < upserts.length; i += 500) {
    const { error } = await supabaseAdmin
      .from('book_of_business')
      .upsert(upserts.slice(i, i + 500), { onConflict: 'broker_id,carrier,member_id', ignoreDuplicates: false })
    if (error) console.error('[uploadRoster] book_of_business upsert error:', error.message)
  }
}

export interface UploadResult {
  uploadId: string
  rowCount: number
  matched: number
  missing: number
  new: number
  alertCount: number
  error?: string
}

export interface RoutedBroker {
  brokerId: string
  name: string
  npn: string | null
  rowCount: number
}

export interface UnmatchedGroup {
  npn: string
  name: string
  rowCount: number
}

export interface RoutingResult {
  totalRows: number
  routedBrokers: RoutedBroker[]
  unmatchedRows: UnmatchedGroup[]
  alertsGenerated: number
  error?: string
}

// Broker identifier column names (case-insensitive match)
const BROKER_COLUMNS = ['agent_npn', 'npn', 'agent_name', 'broker_name', 'writing_agent', 'agent_id']

function detectBrokerColumn(headers: string[]): string | null {
  for (const h of headers) {
    if (BROKER_COLUMNS.includes(h.toLowerCase().replace(/\s+/g, '_'))) return h
  }
  return null
}

export async function uploadRoster(formData: FormData): Promise<UploadResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const carrier = (formData.get('carrier') as string ?? '').toLowerCase().trim()
  const file = formData.get('file') as File | null

  if (!carrier) return { uploadId: '', rowCount: 0, matched: 0, missing: 0, new: 0, alertCount: 0, error: 'Missing carrier' }
  if (!file || file.size === 0) return { uploadId: '', rowCount: 0, matched: 0, missing: 0, new: 0, alertCount: 0, error: 'No file provided' }

  const { data: agencyRow } = await supabase.from('agencies').select('id').eq('owner_id', user.id).maybeSingle()
  let agencyId: string | null = agencyRow?.id ?? null
  let brokerId: string | null = null

  const brokerIdParam = formData.get('broker_id') as string | null

  const { data: brokerRow } = await supabase.from('brokers').select('id, agency_id').eq('user_id', user.id).maybeSingle()
  if (brokerRow) {
    brokerId = brokerRow.id
    if (!agencyId) agencyId = brokerRow.agency_id
  }

  if (brokerIdParam && agencyRow) {
    brokerId = brokerIdParam
  }

  if (!agencyId) return { uploadId: '', rowCount: 0, matched: 0, missing: 0, new: 0, alertCount: 0, error: 'No agency found for user' }

  const supabaseAdmin = createServiceClient()

  const fileExt = file.name.split('.').pop() ?? 'xlsx'
  const storagePath = `${agencyId}/${Date.now()}_${carrier}.${fileExt}`
  const buffer = await file.arrayBuffer()
  const { error: storageError } = await supabaseAdmin.storage
    .from('roster-uploads')
    .upload(storagePath, new Uint8Array(buffer), { contentType: file.type || 'application/octet-stream' })

  if (storageError) {
    return { uploadId: '', rowCount: 0, matched: 0, missing: 0, new: 0, alertCount: 0, error: `Storage error: ${storageError.message}` }
  }

  // ── Parse with per-row error capture ────────────────────────────────────────
  let parseResult: Awaited<ReturnType<typeof parseRosterFileWithErrors>>
  try {
    parseResult = parseRosterFileWithErrors(buffer, carrier)
  } catch (parseErr) {
    const msg = parseErr instanceof Error ? parseErr.message : 'File could not be parsed'
    return { uploadId: '', rowCount: 0, matched: 0, missing: 0, new: 0, alertCount: 0, error: msg }
  }

  const { rows, errors: parseErrors } = parseResult

  if (rows.length === 0) {
    return {
      uploadId: '', rowCount: 0, matched: 0, missing: 0, new: 0, alertCount: 0,
      error: `No valid rows found in file. ${parseErrors.length} row(s) had errors.`,
    }
  }

  const { data: uploadRecord, error: uploadErr } = await supabaseAdmin
    .from('roster_uploads')
    .insert({
      agency_id: agencyId,
      broker_id: brokerId,
      uploaded_by: user.id,
      carrier,
      file_path: storagePath,
      row_count: rows.length,
      status: 'processing',
    })
    .select('id')
    .single()

  if (uploadErr || !uploadRecord) {
    return { uploadId: '', rowCount: rows.length, matched: 0, missing: 0, new: 0, alertCount: 0, error: `DB error: ${uploadErr?.message}` }
  }

  const uploadId = uploadRecord.id

  // ── Persist bad rows to error table ─────────────────────────────────────────
  if (parseErrors.length > 0) {
    const errorRecords = parseErrors.map(e => ({
      upload_id: uploadId,
      agency_id: agencyId,
      row_index: e.rowIndex,
      reason: e.reason,
      raw_data: e.rawData,
    }))
    for (let i = 0; i < errorRecords.length; i += 200) {
      const { error: errInsertErr } = await supabaseAdmin
        .from('roster_upload_errors')
        .insert(errorRecords.slice(i, i + 200))
      if (errInsertErr) {
        console.error('[uploadRoster] roster_upload_errors insert failed:', errInsertErr.message)
      }
    }
    console.warn(`[uploadRoster] ${parseErrors.length} rows had parse errors — logged to roster_upload_errors`)
  }

  const memberRecords = rows.map(r => ({
    upload_id: uploadId,
    agency_id: agencyId,
    carrier,
    member_id: r.member_id ?? null,
    full_name: r.full_name,
    name_hash: hashName(r.full_name, r.dob),
    dob_hash: r.dob ? hashName(r.dob) : null,
    effective_date: r.effective_date ? parseDate(r.effective_date) : null,
    plan_name: r.plan_name ?? null,
    plan_id: r.plan_id ?? null,
    status: r.status ?? null,
    raw_row: r.raw,
  }))

  for (let i = 0; i < memberRecords.length; i += 500) {
    const { error: memberErr } = await supabaseAdmin
      .from('roster_members')
      .insert(memberRecords.slice(i, i + 500))
    if (memberErr) console.error('[uploadRoster] roster_members insert error:', memberErr.message)
  }

  const diffResult = await diffRosterAgainstGHL(uploadId, agencyId, rows, carrier, brokerId ?? '')

  await upsertToBookOfBusiness(rows, { agencyId, brokerId, userId: user.id, carrier })

  if (diffResult.alertCount > 0) {
    // Intentionally fire-and-forget — failures are logged inside notifyNewSwitchAlerts
    notifyNewSwitchAlerts(uploadId, agencyId).catch(err =>
      console.error('[uploadRoster] notifyNewSwitchAlerts error (non-fatal):', err?.message ?? err)
    )
  }

  return {
    uploadId,
    rowCount: rows.length,
    matched: diffResult.matched,
    missing: diffResult.missing,
    new: diffResult.new,
    alertCount: diffResult.alertCount,
    ...(parseErrors.length > 0 && { parseErrorCount: parseErrors.length }),
  }
}

export async function routeMasterRoster(formData: FormData): Promise<RoutingResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const carrier = (formData.get('carrier') as string ?? '').toLowerCase().trim()
  const file = formData.get('file') as File | null

  if (!carrier || !file || file.size === 0) {
    return { totalRows: 0, routedBrokers: [], unmatchedRows: [], alertsGenerated: 0, error: 'Missing carrier or file' }
  }

  const { data: agencyRow } = await supabase.from('agencies').select('id').eq('owner_id', user.id).maybeSingle()
  const { data: brokerRow } = await supabase.from('brokers').select('id, agency_id').eq('user_id', user.id).maybeSingle()
  const agencyId = agencyRow?.id ?? brokerRow?.agency_id ?? null
  if (!agencyId) return { totalRows: 0, routedBrokers: [], unmatchedRows: [], alertsGenerated: 0, error: 'No agency found' }

  const supabaseAdmin = createServiceClient()
  const buffer = await file.arrayBuffer()

  let masterParseResult: Awaited<ReturnType<typeof parseRosterFileWithErrors>>
  try {
    masterParseResult = parseRosterFileWithErrors(buffer, carrier)
  } catch (parseErr) {
    const msg = parseErr instanceof Error ? parseErr.message : 'File could not be parsed'
    return { totalRows: 0, routedBrokers: [], unmatchedRows: [], alertsGenerated: 0, error: msg }
  }
  const rows = masterParseResult.rows

  if (rows.length === 0) {
    return { totalRows: 0, routedBrokers: [], unmatchedRows: [], alertsGenerated: 0, error: `No valid rows found in file. ${masterParseResult.errors.length} row(s) had errors.` }
  }

  // Upload raw file once
  const fileExt = file.name.split('.').pop() ?? 'xlsx'
  const storagePath = `${agencyId}/${Date.now()}_master_${carrier}.${fileExt}`
  await supabaseAdmin.storage
    .from('roster-uploads')
    .upload(storagePath, new Uint8Array(buffer), { contentType: file.type || 'application/octet-stream' })
    .catch(() => {})

  // Detect broker column in raw rows
  const firstRow = rows[0]?.raw
  const headers = firstRow ? Object.keys(firstRow) : []
  const brokerCol = detectBrokerColumn(headers)

  if (!brokerCol) {
    // No broker column found -- treat as single-broker upload
    const singleResult = new FormData()
    singleResult.set('carrier', carrier)
    singleResult.set('file', file)
    const res = await uploadRoster(singleResult)
    const brokerId = agencyRow ? null : brokerRow?.id ?? null
    const brokerName = brokerRow ? `Unknown` : 'All Brokers'
    return {
      totalRows: res.rowCount,
      routedBrokers: [{ brokerId: brokerId ?? '', name: brokerName, npn: null, rowCount: res.rowCount }],
      unmatchedRows: [],
      alertsGenerated: res.alertCount,
    }
  }

  // Group rows by broker identifier
  const groups = new Map<string, typeof rows>()
  for (const row of rows) {
    const key = String(row.raw[brokerCol] ?? '').trim()
    if (!key) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row)
  }

  // Load all brokers for matching
  const { data: agencyBrokers } = await supabaseAdmin
    .from('brokers')
    .select('id, first_name, last_name, npn, role')
    .eq('agency_id', agencyId)

  const brokers = agencyBrokers ?? []

  function matchBroker(key: string): (typeof brokers)[0] | null {
    const k = key.toLowerCase()
    // NPN match (exact, normalized)
    const byNpn = brokers.find(b => b.npn && b.npn.toLowerCase() === k)
    if (byNpn) return byNpn
    // Full name match (case insensitive)
    const byName = brokers.find(b => {
      const full = `${b.first_name} ${b.last_name}`.toLowerCase()
      return full === k || normalizeStr(full) === normalizeStr(k)
    })
    return byName ?? null
  }

  const routedBrokers: RoutedBroker[] = []
  const unmatchedRows: UnmatchedGroup[] = []
  let totalAlerts = 0

  for (const [key, groupRows] of groups) {
    const matched = matchBroker(key)
    if (matched) {
      // Create upload record per broker
      const { data: uploadRecord } = await supabaseAdmin
        .from('roster_uploads')
        .insert({
          agency_id: agencyId,
          broker_id: matched.id,
          uploaded_by: user.id,
          carrier,
          file_path: storagePath,
          row_count: groupRows.length,
          status: 'processing',
        })
        .select('id')
        .single()

      if (uploadRecord) {
        const memberRecords = groupRows.map(r => ({
          upload_id: uploadRecord.id,
          agency_id: agencyId,
          carrier,
          member_id: r.member_id ?? null,
          full_name: r.full_name,
          name_hash: hashName(r.full_name, r.dob),
          dob_hash: r.dob ? hashName(r.dob) : null,
          effective_date: r.effective_date ? parseDate(r.effective_date) : null,
          plan_name: r.plan_name ?? null,
          plan_id: r.plan_id ?? null,
          status: r.status ?? null,
          raw_row: r.raw,
        }))

        for (let i = 0; i < memberRecords.length; i += 500) {
          try { await supabaseAdmin.from('roster_members').insert(memberRecords.slice(i, i + 500)) } catch {}
        }

        const diff = await diffRosterAgainstGHL(uploadRecord.id, agencyId, groupRows, carrier, matched.id)
        await upsertToBookOfBusiness(groupRows, { agencyId, brokerId: matched.id, userId: user.id, carrier })
        totalAlerts += diff.alertCount
        if (diff.alertCount > 0) {
          notifyNewSwitchAlerts(uploadRecord.id, agencyId).catch(() => {})
        }
      }

      routedBrokers.push({
        brokerId: matched.id,
        name: `${matched.first_name} ${matched.last_name}`,
        npn: matched.npn ?? null,
        rowCount: groupRows.length,
      })
    } else {
      // Flag as unmatched
      try {
        await supabaseAdmin
          .from('roster_uploads')
          .insert({
            agency_id: agencyId,
            broker_id: null,
            uploaded_by: user.id,
            carrier,
            file_path: storagePath,
            row_count: groupRows.length,
            status: 'needs_review',
          })
      } catch {}

      unmatchedRows.push({ npn: key, name: key, rowCount: groupRows.length })
    }
  }

  return {
    totalRows: rows.length,
    routedBrokers,
    unmatchedRows,
    alertsGenerated: totalAlerts,
  }
}

export async function assignUnmatchedGroup(
  agencyId: string,
  brokerId: string,
  carrier: string,
  rows: Array<Record<string, unknown>>
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const supabaseAdmin = createServiceClient()

  const { data: uploadRecord } = await supabaseAdmin
    .from('roster_uploads')
    .insert({
      agency_id: agencyId,
      broker_id: brokerId,
      uploaded_by: user.id,
      carrier,
      file_path: `manual_assign/${Date.now()}`,
      row_count: rows.length,
      status: 'processing',
    })
    .select('id')
    .single()

  if (!uploadRecord) return { success: false, error: 'Failed to create upload record' }

  await supabaseAdmin
    .from('roster_uploads')
    .update({ status: 'complete' })
    .eq('id', uploadRecord.id)

  return { success: true }
}

export async function resolveAlert(alertId: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { error } = await supabase
    .from('switch_alerts')
    .update({ status: 'resolved', resolved_by: user.id, resolved_at: new Date().toISOString() })
    .eq('id', alertId)

  if (error) return { error: error.message }
  return {}
}

export async function dismissAlert(alertId: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { error } = await supabase
    .from('switch_alerts')
    .update({ status: 'dismissed', resolved_by: user.id, resolved_at: new Date().toISOString() })
    .eq('id', alertId)

  if (error) return { error: error.message }
  return {}
}

export async function getAgencyBrokers(): Promise<Array<{ id: string; first_name: string; last_name: string; role: string }>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data: agency } = await supabase.from('agencies').select('id').eq('owner_id', user.id).maybeSingle()
  if (!agency) return []

  const { data: brokers } = await supabase
    .from('brokers')
    .select('id, first_name, last_name, role')
    .eq('agency_id', agency.id)
    .order('last_name')

  return brokers ?? []
}

function parseDate(s: string): string | null {
  if (!s) return null
  const d = new Date(s)
  if (isNaN(d.getTime())) return null
  return d.toISOString().split('T')[0]
}

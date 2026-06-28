import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  ALIAS_MAP,
  CARRIER_KEYWORDS,
  sanitizeMbi,
  resolveHeader,
  buildColumnMap,
  detectColumnsByContent,
  inferCarrier,
  extractHCode,
  cleanPlanName,
  normalizeFullName,
  detectChronicStatus,
} from '@/lib/data-normalization'
import { encryptMbi, hashMbi } from '@/lib/mbi-crypto'

/**
 * RFC 4180-compliant CSV parser.
 * Handles quoted fields (which may contain commas and newlines),
 * escaped double-quotes (""), and CRLF/LF line endings.
 * The naive split-on-comma approach breaks whenever Google Sheets
 * wraps any cell that contains a comma (e.g. "Smith, John",
 * "Devoted Health, Medicare Plans"), shifting every subsequent
 * column index and causing MBI/carrier detection to fail.
 */
function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  let i = 0

  // Normalize line endings
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  while (i < s.length) {
    const ch = s[i]

    if (inQuotes) {
      if (ch === '"') {
        // Peek ahead: "" means escaped quote inside quoted field
        if (s[i + 1] === '"') {
          cell += '"'
          i += 2
        } else {
          // Closing quote — exit quoted mode
          inQuotes = false
          i++
        }
      } else {
        cell += ch
        i++
      }
    } else {
      if (ch === '"') {
        inQuotes = true
        i++
      } else if (ch === ',') {
        row.push(cell.trim())
        cell = ''
        i++
      } else if (ch === '\n') {
        row.push(cell.trim())
        cell = ''
        // Only push non-empty rows (skip blank lines)
        if (row.some(c => c !== '')) rows.push(row)
        row = []
        i++
      } else {
        cell += ch
        i++
      }
    }
  }

  // Flush final cell/row
  row.push(cell.trim())
  if (row.some(c => c !== '')) rows.push(row)

  return rows
}

async function fetchSheetCSV(url: string): Promise<string> {
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (!idMatch) throw new Error('Invalid Google Sheets URL. Please use the full URL from your browser address bar.')

  const sheetId = idMatch[1]
  const gidMatch = url.match(/[?&#]gid=(\d+)/)
  const gid = gidMatch ? gidMatch[1] : '0'

  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`

  const res = await fetch(csvUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })

  if (res.status === 401 || res.status === 403) {
    throw new Error('Cannot access this Google Sheet. Please set it to "Anyone with the link can view" in Share settings.')
  }
  if (res.status === 404) {
    throw new Error('Google Sheet not found. Please check the URL.')
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch Google Sheet (status ${res.status}). Make sure the sheet is publicly accessible.`)
  }

  const text = await res.text()

  if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
    throw new Error('This Google Sheet is not publicly accessible. Go to Share → Change to "Anyone with the link" → Viewer.')
  }

  return text
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (!user || userError) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let broker: { id: string; agency_id: string } | null = null
  const { data: brokerData } = await supabase
    .from('brokers')
    .select('id, agency_id')
    .eq('user_id', user.id)
    .maybeSingle()
  broker = brokerData as { id: string; agency_id: string } | null

  if (!broker) {
    const { createServiceClient } = await import('@/lib/supabase/service')
    const serviceSupabase = createServiceClient()
    const { data: brokerFallback } = await serviceSupabase
      .from('brokers')
      .select('id, agency_id')
      .eq('user_id', user.id)
      .maybeSingle()
    if (!brokerFallback) {
      return NextResponse.json({ error: 'Broker not found' }, { status: 403 })
    }
    broker = brokerFallback as { id: string; agency_id: string }
  }

  let csvText: string
  try {
    const body = await req.json()
    if (!body.sheetsUrl) {
      return NextResponse.json({ error: 'sheetsUrl is required' }, { status: 400 })
    }
    csvText = await fetchSheetCSV(body.sheetsUrl)
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to parse request' },
      { status: 400 }
    )
  }

  const rows = parseCSV(csvText)
  if (rows.length < 2) {
    return NextResponse.json({ error: 'Sheet appears empty' }, { status: 400 })
  }

  const headers = rows[0]
  const dataRows = rows.slice(1)

  const aliasMap = buildColumnMap(headers)
  const missingFields = Object.keys(ALIAS_MAP).filter(f => aliasMap[f] === undefined)
  const contentMap = detectColumnsByContent(headers, dataRows, missingFields)
  const colMap = { ...contentMap, ...aliasMap }

  const records: object[] = []
  let dropped = 0
  // Rejected rows are persisted to roster_upload_errors so brokers have a
  // clear review trail of which rows failed and why — mirrors /api/roster/upload
  const rejectedRows: Array<{ row_index: number; reason: string; raw_data: Record<string, string> }> = []

  for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
    const row = dataRows[rowIdx]
    if (row.every(cell => !cell.trim())) continue

    const get = (field: string) =>
      colMap[field] !== undefined ? (row[colMap[field]] ?? '').trim() : ''

    const rawMbi = get('mbi')
    const mbi = sanitizeMbi(rawMbi)
    if (!mbi) {
      dropped++
      // Never persist or surface the raw MBI value — even invalid ones may be near-miss PHI
      const rawDataSnap: Record<string, string> = {}
      headers.forEach((h, i) => { rawDataSnap[h] = i === colMap['mbi'] ? '[REDACTED]' : (row[i] ?? '') })
      rejectedRows.push({
        row_index: rowIdx + 2, // +2 = 1-based row index + header row
        reason: rawMbi
          ? 'MBI is invalid (must be 9–11 alphanumeric chars after removing dashes/spaces)'
          : 'MBI column is empty or could not be resolved from this row',
        raw_data: rawDataSnap,
      })
      continue
    }

    const firstName   = get('first_name')
    const lastName    = get('last_name')
    const fullNameRaw = get('full_name') || ''
    const fullName    = normalizeFullName(firstName, lastName, fullNameRaw)

    // Raw plan value — carrier inference and H-code extraction both use this
    const planValue = get('plan_code') || ''

    // Extract H-code using shared utility
    const { contract: planContract, pbp: planPbp, planId: extractedPlanId } = extractHCode(planValue)

    // Clean plan name using shared utility
    const cleanedPlanName = cleanPlanName(planValue)

    // Infer carrier using shared utility
    const carrierValue = get('carrier') || ''
    const resolvedCarrier = inferCarrier(carrierValue, planValue)

    // Detect chronic status using shared utility
    const isChronicColumn = get('is_chronic') || ''
    const isChronic = detectChronicStatus(planValue, isChronicColumn)

    // The mbi column was renamed to mbi_plaintext_deprecated (20260607000000_mbi_encryption).
    // Store only ciphertext + deterministic hash — same utils as the MARx path so
    // roster-imported MBIs match MARx-captured MBIs byte-for-byte.
    const mbiHash = hashMbi(mbi)
    records.push({
      mbi_encrypted:        encryptMbi(mbi),
      mbi_hash:             mbiHash,
      member_id:            mbiHash,
      has_mbi:              true,
      agency_id:            broker.agency_id,
      broker_id:            broker.id,
      synced_by:            user.id,
      full_name:            fullName,
      plan_name:            cleanedPlanName,
      plan_id:              extractedPlanId,
      plan_contract:        planContract,
      plan_pbp:             planPbp,
      carrier:              resolvedCarrier,
      carrier_display_name: resolvedCarrier !== 'unknown' ? resolvedCarrier : null,
      status:               'active',
      verification_status:  'unverified',
      enrollment_status:    'active',
      is_chronic:           isChronic,
      last_verified_at:     new Date().toISOString(),
      updated_at:           new Date().toISOString(),
    })
  }

  if (records.length === 0) {
    return NextResponse.json(
      { error: `No valid records found. ${dropped} rows dropped (missing or invalid MBI).` },
      { status: 422 }
    )
  }

  const typedRecords = records as Array<Record<string, unknown>>

  // Deduplicate by mbi_hash — keep last occurrence (most complete data wins)
  const deduped: Record<string, unknown>[] = Object.values(
    typedRecords.reduce<Record<string, Record<string, unknown>>>((acc, record) => {
      const key = `${record.mbi_hash}-${record.agency_id}`
      acc[key] = record
      return acc
    }, {})
  )
  const duplicateCount = typedRecords.length - deduped.length

  const mbiCount = deduped.length
  const planCount = deduped.filter(r => (r as Record<string, unknown>).plan_name).length
  const carrierCount = deduped.filter(r => (r as Record<string, unknown>).carrier !== 'unknown').length

  const { error: upsertError } = await supabase
    .from('book_of_business')
    .upsert(deduped, { onConflict: 'mbi_hash,agency_id', ignoreDuplicates: false })

  if (upsertError) {
    console.error('[sheets-import] upsert error:', JSON.stringify(upsertError))
    return NextResponse.json(
      { error: upsertError.message, detail: upsertError.details, hint: upsertError.hint },
      { status: 500 }
    )
  }

  // Persist rejected rows to roster_upload_errors so brokers can review and
  // correct them without losing track of which members were silently skipped.
  if (rejectedRows.length > 0) {
    const errorInserts = rejectedRows.map(r => ({
      agency_id:     broker.agency_id,
      upload_source: 'sheets_import',
      row_index:     r.row_index,
      reason:        r.reason,
      raw_data:      r.raw_data,
    }))
    const { error: errTableErr } = await supabase
      .from('roster_upload_errors')
      .insert(errorInserts)
    if (errTableErr) {
      // Non-fatal — the import itself succeeded; log but don't fail the response
      console.error('[sheets-import] failed to persist rejected rows:', errTableErr.message)
    }
  }

  return NextResponse.json({
    imported: deduped.length, dropped, mbiCount, planCount, carrierCount,
    ...(duplicateCount > 0 && {
      duplicates: duplicateCount,
      message: `${duplicateCount} duplicate MBI entries were merged`,
    }),
    ...(rejectedRows.length > 0 && {
      rejectedCount: rejectedRows.length,
      message_errors: `${rejectedRows.length} row(s) had invalid or missing MBIs and were logged for review`,
    }),
  })
}
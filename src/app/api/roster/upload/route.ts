import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import * as XLSX from 'xlsx'
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

export const dynamic = 'force-dynamic'

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
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

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rawRows = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
    }) as string[][]

    if (rawRows.length < 2) {
      return NextResponse.json({ error: 'File appears empty' }, { status: 400 })
    }

    const headers = (rawRows[0] ?? []).map(String)
    const dataRows = rawRows.slice(1).map(r => r.map(String))

    const aliasMap = buildColumnMap(headers)
    const missingFields = Object.keys(ALIAS_MAP).filter(f => aliasMap[f] === undefined)
    const contentMap = detectColumnsByContent(headers, dataRows, missingFields)
    const colMap = { ...contentMap, ...aliasMap }

    const records: object[] = []
    let dropped = 0
    // Collect rejected rows so users can review and correct them
    const rejectedRows: Array<{ row_index: number; reason: string; raw_data: Record<string, string>; member_name: string }> = []

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
        const skipFirst   = colMap['first_name'] !== undefined ? (row[colMap['first_name']] ?? '').trim() : ''
        const skipLast    = colMap['last_name']  !== undefined ? (row[colMap['last_name']]  ?? '').trim() : ''
        const skipFull    = colMap['full_name']  !== undefined ? (row[colMap['full_name']]  ?? '').trim() : ''
        const memberName  = skipFull || `${skipFirst} ${skipLast}`.trim() || `Row ${rowIdx + 2}`
        rejectedRows.push({
          row_index: rowIdx + 2, // +2 = 1-based + header row
          reason: rawMbi
            ? 'MBI is invalid (must be 9–11 alphanumeric chars after removing dashes/spaces)'
            : 'MBI column is empty or could not be resolved',
          raw_data: rawDataSnap,
          member_name: memberName,
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
        { error: `No valid records found. ${dropped} rows dropped (missing or invalid MBI).`, dropped, rejectedRows },
        { status: 422 }
      )
    }

    const typedRecords = records as Array<Record<string, unknown>>

    // Deduplicate by mbi_hash — keep last occurrence (most complete data wins)
    const deduped = Object.values(
      typedRecords.reduce((acc, record) => {
        const key = `${record.mbi_hash}-${record.agency_id}`
        acc[key] = record
        return acc
      }, {} as Record<string, Record<string, unknown>>)
    )
    const duplicateCount = typedRecords.length - deduped.length

    const mbiCount = deduped.length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dedupedTyped = deduped as any[]
    const planCount = dedupedTyped.filter((r: any) => r.plan_name).length
    const carrierCount = dedupedTyped.filter((r: any) => r.carrier !== 'unknown').length

    const { error: upsertError } = await supabase
      .from('book_of_business')
      .upsert(deduped, { onConflict: 'mbi_hash,agency_id', ignoreDuplicates: false })

    if (upsertError) {
      console.error('[roster/upload] upsert error:', JSON.stringify(upsertError))
      return NextResponse.json(
        { error: upsertError.message, detail: upsertError.details, hint: upsertError.hint },
        { status: 500 }
      )
    }

    // Persist rejected rows so users can download/review them via the dashboard
    if (rejectedRows.length > 0) {
      const errorInserts = rejectedRows.map(r => ({
        agency_id: broker.agency_id,
        upload_source: 'mbi_upload',
        row_index: r.row_index,
        reason: r.reason,
        raw_data: r.raw_data,
      }))
      const { error: errTableErr } = await supabase
        .from('roster_upload_errors')
        .insert(errorInserts)
      if (errTableErr) {
        // Non-fatal — log but don't fail the overall upload
        console.error('[roster/upload] failed to log rejected rows:', errTableErr.message)
      }
    }

    return NextResponse.json({
      imported: deduped.length, dropped, mbiCount, planCount, carrierCount,
      ...(duplicateCount > 0 && { duplicates: duplicateCount, message: `${duplicateCount} duplicate MBI entries were merged` }),
      ...(rejectedRows.length > 0 && {
        rejectedCount: rejectedRows.length,
        message_errors: `${rejectedRows.length} row(s) had invalid MBIs and were logged for review.`,
        skipped: rejectedRows.map(r => ({ name: r.member_name, reason: r.reason, row: r.row_index })),
      }),
    })
  } catch (err: unknown) {
    console.error('[roster/upload] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

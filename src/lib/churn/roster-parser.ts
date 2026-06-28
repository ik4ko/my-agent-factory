import * as XLSX from 'xlsx'
import { createHash } from 'crypto'

export interface RosterRow {
  member_id?: string
  full_name: string
  dob?: string
  effective_date?: string
  plan_name?: string
  plan_id?: string
  status?: string
  raw: Record<string, unknown>
}

/** Describes a single row that failed to parse */
export interface RosterParseError {
  rowIndex: number
  reason: string
  rawData: Record<string, unknown>
}

/** Extended result that includes both good rows and row-level errors */
export interface ParseResult {
  rows: RosterRow[]
  errors: RosterParseError[]
}

export function normalizeStr(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '')
}

export function hashName(name: string, dob?: string): string {
  return createHash('sha256')
    .update(`${normalizeStr(name)}|${dob ?? ''}`)
    .digest('hex')
}

// Carrier-specific column name maps.
// Values may be a single string or an array of fallback candidates
// (first one found in the actual CSV headers wins).
const CARRIER_COLUMNS: Record<string, Record<string, string | string[]>> = {
  humana: {
    // "All Columns" CSV export from Humana Vantage → Active Policies → Reports
    full_name:      ['Name', 'Member Name', 'Client Name'],
    member_id:      ['ID', 'Member ID', 'Policy Number'],
    plan_name:      ['Plan Type', 'Plan Name', 'Product'],
    effective_date: ['Effective Date', 'Eff Date'],
    dob:            ['Date of Birth', 'DOB', 'Birth Date'],
    status:         ['Status', 'Policy Status'],
  },
  uhc: {
    full_name:      'Full Name',
    member_id:      'MemberID',
    plan_name:      'Product',
    effective_date: 'EffDate',
    dob:            'DOB',
    status:         'Status',
  },
  aetna: {
    full_name:      'MEMBER_NAME',
    member_id:      'MEMBER_ID',
    plan_name:      'PLAN_DESC',
    effective_date: 'EFF_DATE',
    dob:            'DOB',
    status:         'STATUS',
  },
  wellcare: {
    full_name:      'Member Name',
    member_id:      'Member ID',
    plan_name:      'Plan Name',
    effective_date: 'Effective Date',
    dob:            'DOB',
    status:         'Status',
  },
  bcbs: {
    full_name:      'SUBSCRIBER_NAME',
    member_id:      'SUBSCRIBER_ID',
    plan_name:      'PLAN_NAME',
    effective_date: 'EFFECTIVE_DATE',
    dob:            'DATE_OF_BIRTH',
    status:         'STATUS',
  },
  cigna: {
    full_name:      'Member Name',
    member_id:      'Member ID',
    plan_name:      'Plan',
    effective_date: 'Effective Date',
    dob:            'DOB',
    status:         'Status',
  },
}

function detectColumns(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const h of headers) {
    const l = h.toLowerCase()
    if (!map.full_name      && (l.includes('name') && !l.includes('plan')))         map.full_name      = h
    if (!map.member_id      && (l.includes('memberid') || l === 'id' || (l.includes('member') && l.includes('id')))) map.member_id = h
    if (!map.plan_name      && (l.includes('plan') || l.includes('product') || l.includes('desc'))) map.plan_name = h
    if (!map.effective_date && (l.includes('eff') || l.startsWith('effective')))    map.effective_date = h
    if (!map.dob            && (l === 'dob' || l.includes('birth') || l.includes('birthdate'))) map.dob = h
    if (!map.status         && l === 'status')                                       map.status         = h
  }
  // Last resort: first column = name
  if (!map.full_name && headers.length > 0) map.full_name = headers[0]
  return map
}

function extractValue(row: Record<string, unknown>, col: string | undefined): string {
  if (!col) return ''
  return String(row[col] ?? '').trim()
}

// Resolve carrier column candidates (string | string[]) against actual CSV headers.
// Returns a map of field → matched header name (or undefined if not found).
function resolveCarrierColumns(
  headers: string[],
  mapping: Record<string, string | string[]>
): Record<string, string | undefined> {
  const resolved: Record<string, string | undefined> = {}
  for (const [field, candidates] of Object.entries(mapping)) {
    const list = Array.isArray(candidates) ? candidates : [candidates]
    resolved[field] = list.find(c => headers.includes(c))
  }
  return resolved
}

/**
 * Parses a roster file and returns good rows only (original signature preserved).
 * Silently drops malformed rows — use parseRosterFileWithErrors for full diagnostics.
 */
export function parseRosterFile(buffer: ArrayBuffer, carrier: string): RosterRow[] {
  try {
    return parseRosterFileWithErrors(buffer, carrier).rows
  } catch {
    return []
  }
}

/**
 * Parses a roster file with per-row error capture.
 * Returns both the successfully-parsed rows AND a log of every row that failed,
 * including the reason and raw data — so callers can persist failures for user review.
 *
 * Throws only on catastrophic file-level errors (corrupt workbook, empty sheet).
 */
export function parseRosterFileWithErrors(buffer: ArrayBuffer, carrier: string): ParseResult {
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' })
  } catch (err) {
    throw new Error(
      `Could not read workbook: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  const sheetName = workbook.SheetNames[0]
  if (!sheetName) throw new Error('Workbook contains no sheets')

  const sheet = workbook.Sheets[sheetName]
  let rawRows: Record<string, unknown>[]
  try {
    rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  } catch (err) {
    throw new Error(
      `Could not parse sheet "${sheetName}": ${err instanceof Error ? err.message : String(err)}`
    )
  }

  if (rawRows.length === 0) throw new Error('Sheet is empty — no data rows found')

  const headers = Object.keys(rawRows[0])
  const carrierKey = carrier.toLowerCase().split('_')[0] // bcbs_ca → bcbs
  const carrierMapping = CARRIER_COLUMNS[carrierKey]
  const colMap: Record<string, string | undefined> = carrierMapping
    ? resolveCarrierColumns(headers, carrierMapping)
    : detectColumns(headers)

  const rows: RosterRow[] = []
  const errors: RosterParseError[] = []

  rawRows.forEach((row, idx) => {
    try {
      const name = extractValue(row, colMap.full_name)
      if (!name) {
        errors.push({
          rowIndex: idx + 2, // +2 = 1-based + header row
          reason: 'Missing required field: full_name (member name could not be resolved)',
          rawData: row,
        })
        return
      }

      // ── Junk row guard ──────────────────────────────────────────────────────
      // Reject rows whose "name" column is clearly a formula, subtotal, or
      // summary cell rather than an actual person.  Patterns we filter out:
      //   • Contains "=" (Excel formula artifact)
      //   • Contains "TOTAL" (subtotal / summary row)
      //   • Consists entirely of digits, spaces, commas, colons, +−×/= signs
      //     (e.g. "450-3000= 3,450 TOTAL: 6")
      //   • Fewer than 2 characters after trimming
      const junkName = /=|TOTAL/i.test(name)
        || /^[\d\s\.,;\:\+\-\*\/\(\)=]+$/.test(name.trim())
        || name.trim().length < 2
      if (junkName) {
        errors.push({
          rowIndex: idx + 2,
          reason: `Skipped non-person row: "${name.slice(0, 40)}" does not look like a member name`,
          rawData: row,
        })
        return
      }

      rows.push({
        member_id:      extractValue(row, colMap.member_id) || undefined,
        full_name:      name,
        dob:            extractValue(row, colMap.dob) || undefined,
        effective_date: extractValue(row, colMap.effective_date) || undefined,
        plan_name:      extractValue(row, colMap.plan_name) || undefined,
        plan_id:        undefined,
        status:         extractValue(row, colMap.status) || undefined,
        raw:            row,
      })
    } catch (err) {
      errors.push({
        rowIndex: idx + 2,
        reason: `Row parse exception: ${err instanceof Error ? err.message : String(err)}`,
        rawData: row,
      })
    }
  })

  return { rows, errors }
}

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { createServiceClient } from '@/lib/supabase/service'

// ── Field data accepted by the engine ────────────────────────────────────────

export interface VCCFieldData {
  client_name:      string
  client_dob?:      string
  medicare_id?:     string
  doctor_name?:     string
  doctor_fax?:      string
  broker_npn?:      string
  broker_name?:     string
  agent_phone?:     string
  carrier_id?:      string
  plan_name?:       string
  plan_year?:       string
  submission_date?: string
  // SSBCI / C-SNP checkbox triggers
  is_chronic?:      boolean  // true → check the C-SNP / Chronic Condition box
  is_renewal?:      boolean  // true → check "Renewal", false → check "Initial"
}

// ── Field map entry ───────────────────────────────────────────────────────────
//
// Each key in a template's field_map must be one of the VCCFieldData keys
// (or a carrier-specific alias resolved via FIELD_ALIASES below).
//
// type breakdown:
//   'text'      — draw the raw string value at (x, y)
//   'checkbox'  — draw checkboxSymbol (default 'X') only when the mapped data
//                 value equals checkboxValue (case-insensitive). Use for
//                 boolean flags (is_chronic, is_renewal) and enum selectors.
//   'date'      — parse and reformat client_dob / submission_date per dateFormat
//   'phone'     — normalise to (NXX) NXX-XXXX before drawing
//
// Coordinates are measured from the BOTTOM-LEFT corner of the page (pdf-lib
// convention). Use the test-fill feature at /dashboard/vcc/templates to
// calibrate coordinates against the actual carrier PDF.

export type FieldType = 'text' | 'checkbox' | 'date' | 'phone'

export interface FieldMapEntry {
  page:            number
  x:               number
  y:               number
  type?:           FieldType    // default: 'text'
  size?:           number       // font pt, default 10
  maxLength?:      number       // truncate text at this length
  bold?:           boolean      // use HelveticaBold instead of Helvetica
  dateFormat?:     string       // for type 'date': 'MM/DD/YYYY' | 'MM-DD-YYYY' | 'YYYY-MM-DD'
  checkboxValue?:  string       // for type 'checkbox': value that triggers the mark (default 'true')
  checkboxSymbol?: string       // character to draw when checked (default 'X')
}

// ── Canonical field aliases ───────────────────────────────────────────────────
//
// Carrier PDFs sometimes label fields differently from our internal keys.
// Add an alias here instead of changing the caller — the engine resolves it.

const FIELD_ALIASES: Record<string, keyof VCCFieldData> = {
  member_name:         'client_name',
  beneficiary_name:    'client_name',
  date_of_birth:       'client_dob',
  dob:                 'client_dob',
  mbi:                 'medicare_id',
  medicare_beneficiary_id: 'medicare_id',
  physician_name:      'doctor_name',
  physician_fax:       'doctor_fax',
  npn:                 'broker_npn',
  agent_npn:           'broker_npn',
  agent_name:          'broker_name',
  date_signed:         'submission_date',
  effective_date:      'submission_date',
}

// ── Value formatters ──────────────────────────────────────────────────────────

function formatDate(raw: string, fmt = 'MM/DD/YYYY'): string {
  // Accept ISO dates (YYYY-MM-DD), US dates (MM/DD/YYYY), and variations
  const clean = raw.replace(/[^\d]/g, '')
  if (clean.length < 8) return raw // unparseable — pass through

  let year: string, month: string, day: string

  if (raw.match(/^\d{4}-\d{2}-\d{2}/)) {
    // ISO format
    year  = clean.slice(0, 4)
    month = clean.slice(4, 6)
    day   = clean.slice(6, 8)
  } else {
    // MM/DD/YYYY or similar
    month = clean.slice(0, 2)
    day   = clean.slice(2, 4)
    year  = clean.slice(4, 8)
  }

  switch (fmt) {
    case 'MM-DD-YYYY': return `${month}-${day}-${year}`
    case 'YYYY-MM-DD': return `${year}-${month}-${day}`
    case 'MM/DD/YY':   return `${month}/${day}/${year.slice(2)}`
    default:           return `${month}/${day}/${year}` // MM/DD/YYYY
  }
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return raw // non-standard — pass through
}

// ── Build the data lookup map ─────────────────────────────────────────────────

function buildDataMap(data: VCCFieldData): Record<string, string> {
  return {
    client_name:     data.client_name ?? '',
    client_dob:      data.client_dob  ?? '',
    medicare_id:     data.medicare_id ?? '',
    doctor_name:     data.doctor_name ?? '',
    doctor_fax:      data.doctor_fax  ?? '',
    broker_npn:      data.broker_npn  ?? '',
    broker_name:     data.broker_name ?? '',
    agent_phone:     data.agent_phone ?? '',
    carrier_id:      data.carrier_id  ?? '',
    plan_name:       data.plan_name   ?? '',
    plan_year:       data.plan_year   ?? String(new Date().getFullYear()),
    submission_date: data.submission_date ?? new Date().toLocaleDateString('en-US'),
    is_chronic:      data.is_chronic  ? 'true' : 'false',
    is_renewal:      data.is_renewal  ? 'true' : 'false',
  }
}

// ── Resolve field key through aliases ─────────────────────────────────────────

function resolveKey(rawKey: string, dataMap: Record<string, string>): string | null {
  if (rawKey in dataMap) return rawKey
  const alias = FIELD_ALIASES[rawKey.toLowerCase()]
  if (alias && alias in dataMap) return alias as string
  return null
}

// ── Core rendering ─────────────────────────────────────────────────────────────

function renderField(
  entry:   FieldMapEntry,
  rawValue: string,
  page:    ReturnType<PDFDocument['getPages']>[number],
  regularFont: Awaited<ReturnType<PDFDocument['embedFont']>>,
  boldFont:    Awaited<ReturnType<PDFDocument['embedFont']>>,
): void {
  const font  = (entry.bold) ? boldFont : regularFont
  const size  = entry.size ?? 10
  const type  = entry.type ?? 'text'

  switch (type) {

    case 'checkbox': {
      const trigger = (entry.checkboxValue ?? 'true').toLowerCase()
      if (rawValue.toLowerCase() !== trigger) return   // unchecked — draw nothing
      const symbol = entry.checkboxSymbol ?? 'X'
      page.drawText(symbol, { x: entry.x, y: entry.y, size, font, color: rgb(0, 0, 0) })
      break
    }

    case 'date': {
      if (!rawValue) return
      const formatted = formatDate(rawValue, entry.dateFormat)
      const value = entry.maxLength ? formatted.slice(0, entry.maxLength) : formatted
      page.drawText(value, { x: entry.x, y: entry.y, size, font, color: rgb(0, 0, 0) })
      break
    }

    case 'phone': {
      if (!rawValue) return
      const formatted = formatPhone(rawValue)
      page.drawText(formatted, { x: entry.x, y: entry.y, size, font, color: rgb(0, 0, 0) })
      break
    }

    default: {
      if (!rawValue) return
      const value = entry.maxLength ? rawValue.slice(0, entry.maxLength) : rawValue
      page.drawText(value, { x: entry.x, y: entry.y, size, font, color: rgb(0, 0, 0) })
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function fillVCCForm(
  templatePath: string,
  fieldMap:     Record<string, FieldMapEntry>,
  data:         VCCFieldData,
): Promise<Uint8Array> {
  const supabase = createServiceClient()
  const dataMap  = buildDataMap(data)

  let pdfDoc: PDFDocument

  // PHI note: fileData is a Blob that lives in JS heap — never written to disk.
  // The resulting Uint8Array from pdfDoc.save() is also heap-only and is either
  // returned to the caller for direct transmission (fax) or passed to
  // saveFilledPDF for storage in the encrypted VCC-filled bucket.
  const { data: fileData, error } = await supabase.storage
    .from('vcc-templates')
    .download(templatePath)

  if (error || !fileData) {
    // No template uploaded yet — build a minimal plain-text fallback PDF
    pdfDoc = await PDFDocument.create()
    const fallbackPage = pdfDoc.addPage([612, 792])
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
    const bodyFont = await pdfDoc.embedFont(StandardFonts.Helvetica)

    fallbackPage.drawText('VCC Authorization Form', {
      x: 50, y: 740, size: 16, font: boldFont, color: rgb(0, 0, 0),
    })
    fallbackPage.drawText(`Generated: ${dataMap.submission_date}`, {
      x: 50, y: 718, size: 9, font: bodyFont, color: rgb(0.4, 0.4, 0.4),
    })

    const fallbackFields: [string, string][] = [
      ['Client Name',   dataMap.client_name],
      ['Date of Birth', dataMap.client_dob],
      ['Medicare ID',   dataMap.medicare_id],
      ['Doctor Name',   dataMap.doctor_name],
      ['Doctor Fax',    dataMap.doctor_fax],
      ['Plan Name',     dataMap.plan_name],
      ['Broker NPN',    dataMap.broker_npn],
      ['Broker Name',   dataMap.broker_name],
    ]

    let y = 680
    for (const [label, value] of fallbackFields) {
      if (!value) continue
      fallbackPage.drawText(`${label}:`, { x: 50, y, size: 9, font: boldFont, color: rgb(0, 0, 0) })
      fallbackPage.drawText(value, { x: 160, y, size: 9, font: bodyFont, color: rgb(0, 0, 0) })
      y -= 22
    }

    return pdfDoc.save()
  }

  const arrayBuffer = await fileData.arrayBuffer()
  pdfDoc = await PDFDocument.load(arrayBuffer)

  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const boldFont    = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const pages       = pdfDoc.getPages()

  for (const [rawKey, entry] of Object.entries(fieldMap)) {
    const resolvedKey = resolveKey(rawKey, dataMap)
    if (!resolvedKey) continue

    const rawValue = dataMap[resolvedKey] ?? ''
    // For non-checkbox types, skip empty values to avoid drawing blank text
    if ((entry.type ?? 'text') !== 'checkbox' && !rawValue) continue

    const page = pages[entry.page - 1]
    if (!page) continue

    renderField(entry, rawValue, page, regularFont, boldFont)
  }

  return pdfDoc.save()
}

export async function saveFilledPDF(
  pdfBytes:     Uint8Array,
  agencyId:     string,
  submissionId: string,
): Promise<string> {
  const supabase = createServiceClient()
  const path = `${agencyId}/${submissionId}/filled.pdf`

  const { error } = await supabase.storage
    .from('VCC-filled')
    .upload(path, pdfBytes, { contentType: 'application/pdf', upsert: true })

  if (error) throw new Error(`Failed to save PDF: ${error.message}`)
  return path
}

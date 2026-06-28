// ── Shared Data Normalization Utility ───────────────────────────────────────────────
// Centralized logic for normalizing member data from CSV, Google Sheets, and GHL Contacts
// Ensures consistent field mapping, MBI sanitization, and carrier inference across all ingestion routes

export const ALIAS_MAP: Record<string, string[]> = {
  mbi: [
    'mbi', 'medicare id', 'medicare number', 'medicare beneficiary identifier',
    'medicare beneficiary id', 'claim no', 'claim number', 'member id',
    'subscriber id', 'beneficiary id', 'hic number', 'hicn',
    'medicare #', 'medicare no', 'medicaid id', 'insurance id',
    'id number', 'policy number', 'policy #', 'policy no',
    'beneficiary identifier', 'medicare identifier',
    'mbi number', 'mbi #', 'medicare_id', 'member_id',
    'beneficiary_id', 'medicare id number', 'hic', 'claim_no', 'bene id', 'bene_id',
    'medicare beneficiary identifier (mbi)', 'medicare claim number',
  ],
  full_name: [
    'name', 'full name', 'fullname', 'full_name', 'client name', 'beneficiary',
    'member name', 'patient name', 'insured name', 'policyholder',
    'member', 'insured', 'subscriber name', 'subscriber',
    'client', 'consumer name', 'participant name',
    'member_name', 'client_name', 'beneficiary_name',
    'patient', 'enrollee', 'enrollee name', 'covered person',
    'contact name', 'customer name', 'prospect name',
  ],
  first_name: [
    'first name', 'firstname', 'first', 'fname', 'given name',
    'given', 'first_name', 'f name', 'member first name',
    'beneficiary first name', 'patient first name',
    'client first name', 'customer first name',
  ],
  last_name: [
    'last name', 'lastname', 'last', 'lname', 'surname',
    'family name', 'last_name', 'l name', 'member last name',
    'beneficiary last name', 'patient last name',
    'client last name', 'customer last name',
  ],
  plan_code: [
    'plan', 'plan name', 'plan code', 'plan id', 'planid', 'plan_id', 'plan_name',
    'contract', 'contract id', 'contract number', 'pbp',
    'benefit package', 'product', 'product code', 'coverage',
    'insurance plan', 'health plan', 'plan type', 'program',
    'sunfire', 'carrier plan', 'plan description', 'plan title',
    'current plan', 'enrolled plan', 'insurance product',
    'new plan', 'new_plan', 'plan change', 'switching to',
    'new coverage', 'updated plan', 'plan effective',
    'plan enrollment', 'enrollment plan', 'ma plan',
    'ma plan name', 'medicare plan', 'medicare advantage plan',
    'advantage plan', 'mapd plan', 'mapd', 'hmo plan',
    'ppo plan', 'd-snp plan', 'snp plan',
    'medicare advantage', 'medicare part c', 'part c plan',
  ],
  carrier: [
    'carrier', 'insurance company', 'insurer', 'company',
    'insurance carrier', 'health plan', 'payer', 'payer name',
    'insurance', 'provider', 'insurance provider', 'plan sponsor',
    'carrier name', 'insurance_carrier', 'plan issuer', 'issuer', 'organization',
    'insurance carrier name', 'health plan name',
  ],
  is_chronic: [
    'is_chronic', 'chronic', 'dsnp', 'd-snp', 'dual eligible',
    'dual', 'snp', 'chronic plan', 'special needs',
    'chronic condition', 'special needs plan',
  ],
}

export const CARRIER_KEYWORDS: [string, string][] = [
  // ── Explicit brand/sub-brand mappings ────────────────────────────────────
  // Order matters: longer / more-specific phrases must precede shorter ones
  // to prevent a shorter keyword from shadowing its parent brand match.
  ['peoples health', 'UnitedHealthcare'],   // Peoples Health Network → UHC
  ['carecomplete',   'Humana'],             // CareComplete → Humana
  // ── Standard carrier keywords ───────────────────────────────────────────
  ['humana',        'Humana'],
  ['aetna',         'Aetna Medicare'],
  ['clover',        'Clover Health'],
  ['devoted',       'Devoted Health'],
  ['uhc',           'UnitedHealthcare'],
  ['united',        'UnitedHealthcare'],
  ['wellcare',      'Wellcare'],
  ['anthem',        'Anthem'],
  ['wellpoint',     'Anthem'],
  ['healthfirst',   'Healthfirst Medicare Plan'],
  ['health first',  'Healthfirst Medicare Plan'],
  ['bcbs',          'BCBS'],
  ['blue cross',    'BCBS'],
  ['cigna',         'Cigna'],
  ['carefree',      'Cigna'],
  ['healthspring',  'Cigna'],
  ['kaiser',        'Kaiser Permanente'],
  ['molina',        'Molina Healthcare'],
  ['centene',       'Centene'],
  ['aarp',          'UnitedHealthcare'],
  ['silverscript',  'CVS/Silverscript'],
  ['elevance',      'Elevance Health'],
]

export function sanitizeMbi(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').trim().slice(0, 11)
  // CMS MBI standard: 11 characters exactly, minimum 9 after stripping formatting.
  // Reject short garbage values ('NA', 'REF', '123', etc.) that pass a truthiness
  // check but are not valid Medicare Beneficiary Identifiers.
  return clean.length >= 9 ? clean : ''
}

export function resolveHeader(rawHeader: string): string | null {
  const normalized = rawHeader.toLowerCase().trim()
  for (const [field, aliases] of Object.entries(ALIAS_MAP)) {
    if (aliases.includes(normalized)) return field
  }
  return null
}

export function buildColumnMap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {}
  headers.forEach((h, i) => {
    const field = resolveHeader(h)
    if (field && !(field in map)) map[field] = i
  })
  return map
}

export function detectColumnsByContent(
  headers: string[],
  rows: string[][],
  onlyFields: string[] = Object.keys(ALIAS_MAP)
): Record<string, number> {
  const sampleRows = rows.slice(0, 10)
  const detected: Record<string, number> = {}

  headers.forEach((_, colIndex) => {
    const values = sampleRows
      .map(r => (r[colIndex] ?? '').trim())
      .filter(Boolean)

    if (values.length === 0) return

    if (onlyFields.includes('mbi')) {
      const mbiMatches = values.filter(v =>
        /^[A-Z0-9]{9,11}$/.test(v.toUpperCase().replace(/[^A-Z0-9]/g, ''))
      ).length
      if (mbiMatches / values.length > 0.7 && !('mbi' in detected)) {
        detected['mbi'] = colIndex
      }
    }

    if (onlyFields.includes('full_name')) {
      const nameMatches = values.filter(v =>
        /^[A-Za-z\s\-'.]{4,}$/.test(v) && v.includes(' ')
      ).length
      if (nameMatches / values.length > 0.7 && !('full_name' in detected)) {
        detected['full_name'] = colIndex
      }
    }

    if (onlyFields.includes('plan_code')) {
      const planMatches = values.filter(v =>
        /^[HSE]\d{4}/i.test(v.trim())
      ).length
      if (planMatches / values.length > 0.5 && !('plan_code' in detected)) {
        detected['plan_code'] = colIndex
      }
    }
  })

  return detected
}

export function inferCarrier(carrierValue: string, planValue: string): string {
  let resolvedCarrier = 'unknown'
  
  if (carrierValue) {
    const cl = carrierValue.toLowerCase()
    for (const [kw, name] of CARRIER_KEYWORDS) {
      if (cl.includes(kw)) { resolvedCarrier = name; break }
    }
  }
  
  if (resolvedCarrier === 'unknown' && planValue) {
    const pl = planValue.toLowerCase()
    for (const [kw, name] of CARRIER_KEYWORDS) {
      if (pl.includes(kw)) { resolvedCarrier = name; break }
    }
  }
  
  return resolvedCarrier
}

export function extractHCode(planValue: string): { contract: string | null; pbp: string | null; planId: string | null } {
  const contractPbpMatch = planValue.match(/\b([A-Z]\d{4})-(\d{3})\b/)
  const planContract = contractPbpMatch?.[1] ?? null
  const planPbp = contractPbpMatch?.[2]?.padStart(3, '0') ?? null
  const extractedPlanId = planContract && planPbp ? `${planContract}-${planPbp}` : null
  
  return { contract: planContract, pbp: planPbp, planId: extractedPlanId }
}

export function cleanPlanName(planValue: string): string | null {
  // Strip trailing H-code suffix to get a clean human-readable plan name
  return planValue
    .replace(/\s+[A-Z]\d{4}-\d{3}-?\d{0,3}\s*$/, '').trim() || null
}

export function normalizeFullName(firstName: string, lastName: string, fullName: string): string | null {
  const combined = [firstName, lastName].filter(Boolean).join(' ').trim()
  let result = combined || fullName || null
  
  if (result) {
    // Handle "Last, First" format
    const commaMatch = result.match(/^([^,]+),\s*(.+)$/)
    if (commaMatch) result = `${commaMatch[2].trim()} ${commaMatch[1].trim()}`
  }
  
  return result
}

export function detectChronicStatus(planValue: string, isChronicColumn: string): boolean {
  const planLower = planValue.toLowerCase()
  const isChronicFromPlan =
    planLower.includes('d-snp') || planLower.includes('c-snp') ||
    planLower.includes('i-snp') || planLower.includes('dsnp') ||
    planLower.includes('dual') || planLower.includes('special needs') ||
    planLower.includes('chronic')
  const isChronicFromColumn = ['yes', 'true', '1', 'y'].includes(isChronicColumn.toLowerCase())
  
  return isChronicFromColumn || isChronicFromPlan
}

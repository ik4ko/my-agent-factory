/**
 * Tests for carrier canonicalization logic.
 *
 * This is the most business-critical function in the platform.
 * A false positive means a broker gets a wrong alert.
 * A false negative means a real switch is silently missed.
 *
 * Copy of the production function -- must be kept in sync with
 * src/app/api/marx/verify/route.ts
 */

// ── Production copy of canonicalCarrier + carriersMatch ──────────────────────
function canonicalCarrier(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  if (s.includes('cigna') || s.includes('healthspring') || s.includes('health spring'))  return 'cigna'
  if (s.includes('aetna') || s.includes('cvs aetna'))                                    return 'aetna'
  if (s.includes('humana'))                                                               return 'humana'
  if (s.includes('anthem') || s.includes('elevance') || s.includes('wellpoint') ||
      s.includes('blue cross') || s.includes('bcbs') || s.includes('healthkeepers'))     return 'anthem'
  if (s.includes('united') || s.includes('uhc') || s.includes('optum') ||
      s === 'unitedhealthcare')                                                           return 'uhc'
  if (s.includes('wellcare'))                                                             return 'wellcare'
  if (s.includes('centene') || s.includes('health net'))                                 return 'centene'
  if (s.includes('molina'))                                                               return 'molina'
  if (s.includes('devoted'))                                                              return 'devoted'
  if (s.includes('clover'))                                                               return 'clover'
  if (s.includes('kaiser') || s.includes('permanente'))                                  return 'kaiser'
  if (s.includes('alignment'))                                                            return 'alignment'
  return s
}

function carriersMatch(a: string | null, b: string | null): boolean {
  if (a == null || b == null) return true  // null/undefined only -> no alert (conservative)
  return canonicalCarrier(a) === canonicalCarrier(b)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('canonicalCarrier -- same carrier, different spellings', () => {
  const SAME_CARRIER_PAIRS: [string, string][] = [
    // Cigna / HealthSpring
    ['Cigna', 'HealthSpring'],
    ['CIGNA Medicare', 'Health Spring Medicare Advantage'],
    ['Cigna-HealthSpring', 'Cigna Healthcare'],

    // Aetna / CVS
    ['Aetna', 'CVS Aetna Medicare'],
    ['Aetna Medicare', 'Aetna Medicare Advantage'],

    // Humana variants
    ['Humana', 'Humana Gold Plus'],
    ['Humana Medicare', 'HUMANA GOLD ADVANTAGE'],

    // UHC / UnitedHealthcare
    ['UHC', 'UnitedHealthcare'],
    ['United Healthcare', 'UHC Medicare Solutions'],
    ['UnitedHealthcare', 'Optum Medicare'],

    // Anthem / Blue Cross / Elevance
    ['Anthem', 'Anthem Blue Cross Blue Shield'],
    ['Anthem BCBS', 'Elevance Health Medicare'],
    ['Anthem Blue Cross', 'WellPoint Medicare'],
    ['BCBS of Tennessee', 'Anthem Inc.'],
    ['HealthKeepers Plus', 'Anthem'],

    // Wellcare
    ['WellCare', 'Wellcare Health Plans'],
    ['WellCare Medicare', 'WELLCARE OF KENTUCKY'],
  ]

  test.each(SAME_CARRIER_PAIRS)('"%s" and "%s" are the same carrier', (a, b) => {
    expect(carriersMatch(a, b)).toBe(true)
  })
})

describe('canonicalCarrier -- DIFFERENT carriers must NOT match', () => {
  const DIFFERENT_PAIRS: [string, string][] = [
    ['Humana', 'Cigna'],
    ['Aetna', 'UHC'],
    ['Anthem', 'Humana'],
    ['Cigna', 'Wellcare'],
    ['Devoted', 'Clover'],
    ['Molina', 'Centene'],
    ['Kaiser', 'Aetna'],
    ['Humana Gold Plus', 'UnitedHealthcare Community Plan'],
    ['Cigna-HealthSpring', 'Anthem Blue Cross'],
  ]

  test.each(DIFFERENT_PAIRS)('"%s" and "%s" are DIFFERENT carriers', (a, b) => {
    expect(carriersMatch(a, b)).toBe(false)
  })
})

describe('carriersMatch -- null/unknown safety', () => {
  test('null vs anything returns true (no alert)', () => {
    expect(carriersMatch(null, 'Humana')).toBe(true)
    expect(carriersMatch('Humana', null)).toBe(true)
    expect(carriersMatch(null, null)).toBe(true)
  })

  test('unknown vs known carrier returns false', () => {
    // 'unknown' does not match any carrier key so they differ
    expect(carriersMatch('unknown', 'Humana')).toBe(false)
  })

  test('empty string vs carrier -- empty maps to empty string, so returns false', () => {
    expect(carriersMatch('', 'Humana')).toBe(false)
  })
})

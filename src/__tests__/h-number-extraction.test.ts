/**
 * Tests for H-number extraction from plan_id strings.
 *
 * Medicare plan codes come in many formats — from clean H-numbers to
 * full plan name strings from carrier rosters. The extraction function
 * must handle all of them correctly because a missed extraction means
 * the system cannot compare plans and will never fire a switch alert.
 *
 * Production source: src/app/api/marx/verify/route.ts
 */

// ── Production copy ───────────────────────────────────────────────────────────
function isValidPlanCode(code: string | null | undefined): boolean {
  return !!code && /^[HSE]\d{4}-\d{3}/i.test(code)
}

function extractHNumber(s: string | null | undefined): string | null {
  if (!s) return null
  const m = s.match(/([HSE]\d{4}-\d{3})/i)
  return m ? m[1].toUpperCase() : null
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('isValidPlanCode', () => {
  const VALID = [
    'H4513-083',
    'H1234-001',
    'S0001-000',
    'E0001-001',
    'h4513-083',  // lowercase
    'H4513-083-000',  // extra suffix — still matches prefix
  ]

  const INVALID = [
    null, undefined, '',
    'Humana Gold Plus',
    'H1234',          // missing PBP
    '1234-083',       // missing H prefix
    'H123-083',       // only 3 contract digits
    'H12345-083',     // 5 contract digits
    'plan_id_string',
  ]

  test.each(VALID)('valid: %s', (code) => {
    expect(isValidPlanCode(code)).toBe(true)
  })

  test.each(INVALID as (string | null | undefined)[])('invalid: %s', (code) => {
    expect(isValidPlanCode(code)).toBe(false)
  })
})

describe('extractHNumber — embedded in plan name strings', () => {
  const CASES: [string | null | undefined, string | null][] = [
    // Clean H-numbers
    ['H4513-083', 'H4513-083'],
    ['h4513-083', 'H4513-083'],
    ['S1234-001', 'S1234-001'],

    // Embedded in roster plan name strings (most common case)
    ['Humana Gold Plus H7617-035 PPO', 'H7617-035'],
    ['Cigna-HealthSpring TotalCare H4513-083-0', 'H4513-083'],
    ['Aetna Medicare Advantage H3931-014 HMO', 'H3931-014'],
    ['UnitedHealthcare AARP MedicareComplete H0028-023', 'H0028-023'],

    // Null / empty inputs
    [null, null],
    [undefined, null],
    ['', null],

    // No H-number present
    ['Humana Gold Plus', null],
    ['Unknown Plan', null],
    ['carrier:aetna', null],
  ]

  test.each(CASES)('input: "%s" → "%s"', (input, expected) => {
    expect(extractHNumber(input)).toBe(expected)
  })
})

describe('extractHNumber — edge cases', () => {
  test('picks first H-number when multiple are present', () => {
    // This shouldn't happen in practice but ensure predictable behavior
    expect(extractHNumber('H4513-083 and H7617-035')).toBe('H4513-083')
  })

  test('handles plan names with dashes in text', () => {
    expect(extractHNumber('Cigna-HealthSpring (not a code) H4513-083')).toBe('H4513-083')
  })
})

/**
 * Tests for MBI sanitization.
 *
 * MBI (Medicare Beneficiary Identifier) is the primary lookup key for every
 * MARx verification call. A wrong MBI means we look up the wrong person --
 * or fail to find the member at all, preventing any alert from firing.
 *
 * Valid MBI format: 11 alphanumeric characters, no BILO (B, I, L, O letters)
 * in certain positions -- but we sanitize the format, not validate BILO rules.
 */

// ── Production copies ─────────────────────────────────────────────────────────
// From src/app/api/ghl/callback/route.ts and roster-upload.ts
function sanitizeMbi(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').trim().slice(0, 11)
}

function isValidMbi(mbi: string | null | undefined): boolean {
  if (!mbi) return false
  // Require the input to already be clean: exactly 11 uppercase alphanumeric chars.
  // Callers must sanitize first via sanitizeMbi() before calling this.
  return /^[A-Z0-9]{11}$/.test(mbi.toUpperCase())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('sanitizeMbi -- cleaning input', () => {
  const CASES: [string, string][] = [
    ['1EG4-TE5M-K73',   '1EG4TE5MK73'],  // hyphens removed
    ['1eg4te5mk73',     '1EG4TE5MK73'],  // lowercased
    ['1EG4 TE5M K73',   '1EG4TE5MK73'],  // spaces removed
    ['1EG4TE5MK73',     '1EG4TE5MK73'],  // already clean
    ['  1EG4TE5MK73  ', '1EG4TE5MK73'],  // leading/trailing spaces
    ['1EG4-TE5M-K73X',  '1EG4TE5MK73'],  // truncated to 11
  ]

  test.each(CASES)('sanitize("%s") -> "%s"', (input, expected) => {
    expect(sanitizeMbi(input)).toBe(expected)
  })
})

describe('isValidMbi -- strict 11-char alphanumeric check', () => {
  const VALID = [
    '1EG4TE5MK73',
    'ABCDEFGHIJK',  // 11 chars
    '12345678901',  // 11 digits
  ]

  const INVALID = [
    null, undefined, '',
    '1EG4TE5MK7',   // 10 chars
    '1EG4TE5MK73X', // 12 chars
    '1EG4-TE5MK73', // contains hyphen -- not a clean MBI
  ]

  test.each(VALID)('valid: "%s"', (mbi) => {
    expect(isValidMbi(mbi)).toBe(true)
  })

  test.each(INVALID as (string | null | undefined)[])('invalid: "%s"', (mbi) => {
    expect(isValidMbi(mbi)).toBe(false)
  })
})

describe('sanitizeMbi -> isValidMbi pipeline', () => {
  test('hyphenated MBI becomes valid after sanitize', () => {
    const raw = '1EG4-TE5M-K73'
    const clean = sanitizeMbi(raw)
    expect(isValidMbi(clean)).toBe(true)
    expect(clean).toBe('1EG4TE5MK73')
  })

  test('short raw MBI stays invalid after sanitize', () => {
    const raw = '1EG4-TE5M'   // only 9 chars after strip
    const clean = sanitizeMbi(raw)
    expect(isValidMbi(clean)).toBe(false)
  })
})

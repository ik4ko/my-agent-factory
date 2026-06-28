/**
 * Tests for GHL contact field extraction.
 *
 * GHL contacts store Medicare data in custom fields with broker-defined keys.
 * The extraction must handle:
 *   - Standard field keys (mbi, medicare_id)
 *   - White-labeled GHL instances (same keys, different front-end)
 *   - Both 'customFields' and 'custom_fields' response shapes
 *   - Partial/missing data without crashing
 *
 * Production source: src/app/api/ghl/sync/route.ts
 */

// ── Production copy of GHL_FIELD_MAP and extractGhlFields ────────────────────
const GHL_FIELD_MAP: Record<string, string> = {
  mbi:               'mbi',
  medicare_id:       'mbi',
  medicare_number:   'mbi',
  plan_name:         'plan_name',
  plan:              'plan_name',
  carrier:           'carrier',
  insurance_carrier: 'carrier',
  dob:               'dob',
  date_of_birth:     'dob',
  birthday:          'dob',
}

function extractGhlFields(contact: Record<string, unknown>): Record<string, string> {
  const customFields = (contact.customFields ?? contact.custom_fields ?? []) as
    Array<{ key?: string; id?: string; field_key?: string; value?: unknown }>
  const extracted: Record<string, string> = {}
  for (const field of customFields) {
    const rawKey = field.field_key ?? field.key ?? field.id ?? ''
    const key    = rawKey.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_')
    const mapped = GHL_FIELD_MAP[key]
    if (mapped && field.value != null && String(field.value).trim()) {
      extracted[mapped] = String(field.value).trim()
    }
  }
  return extracted
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('extractGhlFields — standard field keys', () => {
  test('extracts MBI from "mbi" key', () => {
    const contact = {
      customFields: [{ key: 'mbi', value: '1EG4TE5MK73' }],
    }
    expect(extractGhlFields(contact).mbi).toBe('1EG4TE5MK73')
  })

  test('extracts MBI from "medicare_id" alias', () => {
    const contact = {
      customFields: [{ key: 'medicare_id', value: '1EG4TE5MK73' }],
    }
    expect(extractGhlFields(contact).mbi).toBe('1EG4TE5MK73')
  })

  test('extracts MBI from "medicare_number" alias', () => {
    const contact = {
      customFields: [{ key: 'medicare_number', value: '1EG4TE5MK73' }],
    }
    expect(extractGhlFields(contact).mbi).toBe('1EG4TE5MK73')
  })

  test('extracts carrier from "insurance_carrier" alias', () => {
    const contact = {
      customFields: [{ key: 'insurance_carrier', value: 'Humana' }],
    }
    expect(extractGhlFields(contact).carrier).toBe('Humana')
  })

  test('extracts plan_name from "plan" alias', () => {
    const contact = {
      customFields: [{ key: 'plan', value: 'Humana Gold Plus H7617-035' }],
    }
    expect(extractGhlFields(contact).plan_name).toBe('Humana Gold Plus H7617-035')
  })
})

describe('extractGhlFields — response shape variants', () => {
  test('handles "custom_fields" key (older GHL API response)', () => {
    const contact = {
      custom_fields: [{ key: 'mbi', value: '1EG4TE5MK73' }],
    }
    expect(extractGhlFields(contact).mbi).toBe('1EG4TE5MK73')
  })

  test('handles field_key property (white-label GHL variant)', () => {
    const contact = {
      customFields: [{ field_key: 'medicare_id', value: '1EG4TE5MK73' }],
    }
    expect(extractGhlFields(contact).mbi).toBe('1EG4TE5MK73')
  })

  test('handles id property as fallback key', () => {
    const contact = {
      customFields: [{ id: 'mbi', value: '1EG4TE5MK73' }],
    }
    expect(extractGhlFields(contact).mbi).toBe('1EG4TE5MK73')
  })

  test('normalizes key with spaces to underscores', () => {
    const contact = {
      customFields: [{ key: 'Medicare ID', value: '1EG4TE5MK73' }],
    }
    // "Medicare ID" → "medicare_id" → maps to mbi
    expect(extractGhlFields(contact).mbi).toBe('1EG4TE5MK73')
  })
})

describe('extractGhlFields — edge cases', () => {
  test('empty customFields returns empty object', () => {
    expect(extractGhlFields({ customFields: [] })).toEqual({})
  })

  test('missing customFields returns empty object', () => {
    expect(extractGhlFields({})).toEqual({})
  })

  test('null/empty values are skipped', () => {
    const contact = {
      customFields: [
        { key: 'mbi', value: null },
        { key: 'carrier', value: '' },
        { key: 'plan_name', value: '   ' },  // whitespace only
      ],
    }
    expect(extractGhlFields(contact)).toEqual({})
  })

  test('unknown keys are ignored', () => {
    const contact = {
      customFields: [
        { key: 'unknown_field', value: 'somevalue' },
        { key: 'internal_notes', value: 'agent notes' },
      ],
    }
    expect(extractGhlFields(contact)).toEqual({})
  })

  test('multiple fields all extracted correctly', () => {
    const contact = {
      customFields: [
        { key: 'mbi', value: '1EG4TE5MK73' },
        { key: 'carrier', value: 'Humana' },
        { key: 'plan_name', value: 'Humana Gold Plus H7617-035' },
      ],
    }
    const result = extractGhlFields(contact)
    expect(result.mbi).toBe('1EG4TE5MK73')
    expect(result.carrier).toBe('Humana')
    expect(result.plan_name).toBe('Humana Gold Plus H7617-035')
  })
})

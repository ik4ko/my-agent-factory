/**
 * syncGHLContactsToSupabase
 *
 * Pulls all contacts from a GHL sub-account location and upserts them
 * into the book_of_business table. Intended as an agency-level ingestion
 * utility separate from the broker-scoped /api/ghl/sync endpoint.
 *
 * Field resolution strategy:
 *   1. GET /custom-fields/?locationId to learn the agency's custom field IDs
 *   2. Match field names against /mbi/i and /plan.?name/i to locate MBI and plan
 *   3. Paginate GET /contacts/ 100 at a time and upsert each page immediately
 *
 * Carrier derivation:
 *   Scans the plan_name string against the CARRIER_MAP patterns.
 *   Falls back to 'unknown' when no carrier can be inferred.
 *
 * Upsert conflict key: ghl_contact_id (unique per location).
 *
 * Do NOT import this file from anything under src/app/api/roster/ or
 * src/lib/churn/ — those pipelines are intentionally isolated.
 */

import { ghlFetch, getGHLLocationId } from './ghl-client'
import { createServiceClient }        from '@/lib/supabase/service'

// ── Carrier name pattern map ──────────────────────────────────────────────────

const CARRIER_MAP: Array<{ pattern: RegExp; carrier: string }> = [
  { pattern: /humana/i,                     carrier: 'humana'   },
  { pattern: /united\s*health|uhc|unitedhc/i, carrier: 'uhc'   },
  { pattern: /aetna/i,                      carrier: 'aetna'    },
  { pattern: /blue\s*cross|bcbs/i,          carrier: 'bcbs'     },
  { pattern: /wellcare/i,                   carrier: 'wellcare' },
  { pattern: /cigna/i,                      carrier: 'cigna'    },
  { pattern: /devoted/i,                    carrier: 'devoted'  },
  { pattern: /clover/i,                     carrier: 'clover'   },
  { pattern: /scan\b/i,                     carrier: 'scan'     },
  { pattern: /molina/i,                     carrier: 'molina'   },
]

function deriveCarrier(planName: string | null | undefined): string {
  if (!planName) return 'unknown'
  for (const { pattern, carrier } of CARRIER_MAP) {
    if (pattern.test(planName)) return carrier
  }
  return 'unknown'
}

// ── Custom field discovery ────────────────────────────────────────────────────

interface GHLCustomField {
  id:   string
  name: string
}

async function resolveFieldIds(
  agencyId:   string,
  locationId: string,
): Promise<{ mbiFieldId: string | null; planFieldId: string | null }> {
  const res = await ghlFetch(
    agencyId,
    `/custom-fields/?locationId=${encodeURIComponent(locationId)}`,
  )

  if (!res.ok || !res.data) return { mbiFieldId: null, planFieldId: null }

  const fields = (res.data as { customFields?: GHLCustomField[] }).customFields ?? []

  let mbiFieldId:  string | null = null
  let planFieldId: string | null = null

  for (const f of fields) {
    if (!mbiFieldId  && /mbi/i.test(f.name))          mbiFieldId  = f.id
    if (!planFieldId && /plan.?name/i.test(f.name))   planFieldId = f.id
  }

  return { mbiFieldId, planFieldId }
}

// ── Contact custom-field extractor ────────────────────────────────────────────

interface GHLContactCustomField {
  id:    string
  value: string | null
}

function extractFieldValue(
  customFields: GHLContactCustomField[],
  fieldId: string | null,
): string | null {
  if (!fieldId) return null
  const field = customFields.find(f => f.id === fieldId)
  return field?.value?.trim() || null
}

// ── MBI sanitiser (matches the one in ghl/sync/route.ts) ─────────────────────

function sanitiseMbi(raw: string): string | null {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11)
  return clean.length === 11 ? clean : null
}

// ── Contact page fetch ────────────────────────────────────────────────────────

interface GHLContactsPage {
  contacts: Array<{
    id:           string
    firstName?:   string
    lastName?:    string
    name?:        string
    email?:       string
    phone?:       string
    customFields: GHLContactCustomField[]
  }>
  meta?: { startAfter?: string }
}

async function fetchContactPage(
  agencyId:    string,
  locationId:  string,
  cursor:      string | null,
): Promise<{ contacts: GHLContactsPage['contacts']; nextCursor: string | null }> {
  let path = `/contacts/?locationId=${encodeURIComponent(locationId)}&limit=100`
  if (cursor) path += `&startAfter=${encodeURIComponent(cursor)}`

  const res = await ghlFetch(agencyId, path)
  if (!res.ok || !res.data) return { contacts: [], nextCursor: null }

  const page = res.data as GHLContactsPage
  const contacts   = page.contacts ?? []
  const nextCursor = contacts.length === 100 ? (page.meta?.startAfter ?? null) : null

  return { contacts, nextCursor }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function syncGHLContactsToSupabase(
  agencyId: string,
): Promise<{ synced: number; errors: number }> {
  const locationId = await getGHLLocationId(agencyId)
  if (!locationId) {
    console.warn('[ghl-sync-members] no location_id for agency', agencyId)
    return { synced: 0, errors: 0 }
  }

  // Discover custom field IDs for MBI and plan name
  const { mbiFieldId, planFieldId } = await resolveFieldIds(agencyId, locationId)
  console.log('[ghl-sync-members] field IDs resolved', { mbiFieldId, planFieldId })

  const supabase = createServiceClient()
  let synced  = 0
  let errors  = 0
  let cursor: string | null = null

  do {
    const { contacts, nextCursor } = await fetchContactPage(agencyId, locationId, cursor)
    cursor = nextCursor

    if (contacts.length === 0) break

    const rows = contacts
      .filter(c => !!c.id)
      .map(c => {
        const customFields = c.customFields ?? []
        const rawMbi  = extractFieldValue(customFields, mbiFieldId)
        const mbi     = rawMbi ? sanitiseMbi(rawMbi) : null

        const planName = extractFieldValue(customFields, planFieldId)
        const carrier  = deriveCarrier(planName)

        const fullName =
          [c.firstName, c.lastName].filter(Boolean).join(' ').trim()
          || c.name?.trim()
          || null

        return {
          agency_id:      agencyId,
          ghl_contact_id: c.id,
          full_name:      fullName,
          email:          c.email   || null,
          phone:          c.phone   || null,
          mbi,
          plan_name:      planName,
          carrier,
          source:         'ghl_sync',
          updated_at:     new Date().toISOString(),
        }
      })

    // Upsert the full page immediately — no memory accumulation
    const { error } = await supabase
      .from('book_of_business')
      .upsert(rows, { onConflict: 'ghl_contact_id' })

    if (error) {
      console.error('[ghl-sync-members] upsert error:', error.message)
      errors += rows.length
    } else {
      synced += rows.length
    }

  } while (cursor)

  console.log('[ghl-sync-members] complete', { agencyId, synced, errors })
  return { synced, errors }
}

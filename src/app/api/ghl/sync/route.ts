/**
 * POST /api/ghl/sync
 *
 * Production-grade GHL contact bulk import.
 *
 * Architecture:
 *   - Stream-paginates GHL contacts 100 at a time
 *   - Upserts each page immediately (never accumulates all contacts in memory)
 *   - Handles 100 – 10,000+ contacts without hitting the 60-second Vercel limit
 *     by processing in configurable page-count slices per call, storing a cursor
 *     so the next call can resume exactly where it left off
 *   - Tracks live progress in agency_credentials.sync_* columns
 *   - Auto-refreshes GHL access token when < 5 min from expiry
 *
 * White-label GHL:
 *   Standard and white-labeled GHL instances use the identical OAuth/API layer
 *   (marketplace.gohighlevel.com + services.leadconnectorhq.com).
 *   White-labeling only affects the broker's dashboard URL, not our API calls.
 *
 * Body (all optional):
 *   {
 *     force?: boolean    — ignore last_synced_at, pull all contacts from GHL
 *     maxPages?: number  — cap pages fetched this call (default 20 = 2,000 contacts)
 *                          Set higher for a full initial import; lower for incremental
 *   }
 *
 * Response:
 *   {
 *     synced: number, skipped: number, total_fetched: number,
 *     has_more: boolean, cursor: string|null,
 *     mode: 'incremental'|'full',
 *     message: string
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  logCrmImportStarted,
  logCrmImportCompleted,
  extractIp,
} from '@/utils/auditLogger'
import {
  sanitizeMbi,
  inferCarrier,
  extractHCode,
  cleanPlanName,
  detectChronicStatus,
} from '@/lib/data-normalization'
import { encryptMbi, hashMbi } from '@/lib/mbi-crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// Allow up to 60 s on Pro, use all of it for large imports
export const maxDuration = 60

const GHL_API_BASE = 'https://services.leadconnectorhq.com'
const BATCH_SIZE   = 100   // contacts per GHL API page (GHL max)
const DB_BATCH     = 200   // rows per Supabase upsert call

// ── Field extraction ──────────────────────────────────────────────────────────
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
  // Doctor / VCC fax fields (common GHL custom field keys)
  doctor_name:       'doctor_name',
  physician_name:    'doctor_name',
  primary_doctor:    'doctor_name',
  pcp_name:          'doctor_name',
  doctor_fax:        'doctor_fax',
  physician_fax:     'doctor_fax',
  pcp_fax:           'doctor_fax',
  fax_number:        'doctor_fax',
}

function extractGhlFields(contact: Record<string, unknown>): Record<string, string> {
  // GHL API returns customFields as an array in the standard case, but can
  // return null, an empty object {}, or omit the key entirely on malformed
  // or partially-provisioned sub-accounts. The `as Array<...>` cast is not a
  // runtime check — guard explicitly so a bad payload never throws in the loop.
  const raw = contact.customFields ?? contact.custom_fields
  const customFields = Array.isArray(raw)
    ? (raw as Array<{ key?: string; id?: string; field_key?: string; value?: unknown }>)
    : []

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

// ── Token management ──────────────────────────────────────────────────────────
async function getValidToken(agencyId: string, svc: ReturnType<typeof createServiceClient>) {
  const { data: cred } = await svc
    .from('agency_credentials')
    .select('access_token, refresh_token, expires_at, location_id, last_synced_at, sync_cursor')
    .eq('agency_id', agencyId)
    .maybeSingle()

  if (!cred?.access_token) throw new Error('GHL not connected for this agency')

  // Null guard: a missing expires_at means the stored token has no known expiry —
  // rather than silently falling back to the Unix epoch (which forces a token refresh
  // on every single sync call), we require reconnection to obtain a fresh token set.
  if (!cred.expires_at) {
    throw new Error('GHL token missing expiry — please reconnect via the GHL page to refresh your credentials')
  }

  const expiresAt    = new Date(cred.expires_at).getTime()
  const needsRefresh = expiresAt - Date.now() < 5 * 60 * 1000

  if (!needsRefresh) {
    return {
      accessToken:  cred.access_token,
      locationId:   cred.location_id as string,
      lastSyncedAt: cred.last_synced_at as string | null,
      syncCursor:   cred.sync_cursor as string | null,
    }
  }

  const res = await fetch(`${GHL_API_BASE}/oauth/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GHL_CLIENT_ID!,
      client_secret: process.env.GHL_CLIENT_SECRET!,
      grant_type:    'refresh_token',
      refresh_token: cred.refresh_token,
    }),
  })

  if (!res.ok) {
    // Read the response body once — log it safely (server-only), never expose in thrown message
    const rawBody = await res.text().catch(() => '<unreadable>')
    console.error('[ghl/sync] token refresh failed:', res.status, rawBody.slice(0, 200))
    throw new Error(`GHL token refresh failed (HTTP ${res.status}) — please reconnect via the GHL page`)
  }

  const tokens = await res.json() as {
    access_token: string; refresh_token: string; expires_in: number
  }

  const newExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
  await svc.from('agency_credentials').update({
    access_token:  tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at:    newExpiry,
    updated_at:    new Date().toISOString(),
  }).eq('agency_id', agencyId)

  return {
    accessToken:  tokens.access_token,
    locationId:   cred.location_id as string,
    lastSyncedAt: cred.last_synced_at as string | null,
    syncCursor:   cred.sync_cursor as string | null,
  }
}

// ── GHL single-page fetch ─────────────────────────────────────────────────────
async function fetchPage(
  accessToken: string,
  locationId: string,
  cursor: string | null,
  since: string | null,
): Promise<{ contacts: Record<string, unknown>[]; nextCursor: string | null }> {
  const url = new URL(`${GHL_API_BASE}/contacts/`)
  url.searchParams.set('locationId', locationId)
  url.searchParams.set('limit', String(BATCH_SIZE))
  if (cursor)  url.searchParams.set('startAfter', cursor)
  if (since)   url.searchParams.set('startAfterDate', since)

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}`, Version: '2021-07-28' },
  })

  if (res.status === 429) {
    // Rate-limited — caller should wait and retry
    throw Object.assign(new Error('GHL rate limit'), { retryable: true })
  }
  if (!res.ok) {
    throw new Error(`GHL contacts API ${res.status}: ${await res.text().catch(() => '')}`)
  }

  const json = await res.json() as {
    contacts?: Record<string, unknown>[]
    meta?: { startAfter?: string; nextPageUrl?: string }
  }

  const contacts   = json.contacts ?? []
  const nextCursor = contacts.length === BATCH_SIZE ? (json.meta?.startAfter ?? null) : null
  return { contacts, nextCursor }
}

// ── Map contacts → DB records ─────────────────────────────────────────────────
// Returns two record sets per page:
//   crmRecords — ghl_contacts rows (CRM linkage, churn diff input)
//   bobRecords — book_of_business rows for contacts with a valid MBI, using the
//                same encryptMbi/hashMbi/has_mbi mapping as the roster import so
//                GHL-imported members match MARx/roster members byte-for-byte.
function mapContacts(
  contacts: Record<string, unknown>[],
  agencyId: string,
  brokerId: string,
  syncedBy: string,
): { crmRecords: Record<string, unknown>[]; bobRecords: Record<string, unknown>[] } {
  const crmRecords: Record<string, unknown>[] = []
  const bobRecords: Record<string, unknown>[] = []
  const now = new Date().toISOString()

  for (const contact of contacts) {
    const fields   = extractGhlFields(contact)
    const rawMbi   = fields.mbi ?? ''
    const mbi      = rawMbi ? sanitizeMbi(rawMbi) : null
    const fullName = [
      String(contact.firstName ?? ''),
      String(contact.lastName ?? ''),
    ].filter(Boolean).join(' ') || String(contact.name ?? '') || null

    // GHL guarantees `id` on well-formed contacts, but malformed payloads can
    // omit it. String(undefined) produces the literal "undefined" which passes
    // a truthy filter and collides on the unique constraint — skip any contact
    // without a valid non-empty string ID instead.
    const contactId = contact.id != null && String(contact.id).trim()
      ? String(contact.id).trim()
      : null
    if (!contactId) continue

    // Use shared utility functions for plan and carrier normalization
    const planValue = fields.plan_name ?? ''
    const { contract: planContract, pbp: planPbp, planId: extractedPlanId } = extractHCode(planValue)
    const cleanedPlanName = cleanPlanName(planValue)
    const carrierValue = fields.carrier ?? ''
    const resolvedCarrier = inferCarrier(carrierValue, planValue)

    // Detect chronic status from plan name
    const isChronic = detectChronicStatus(planValue, '')

    crmRecords.push({
      agency_id:           agencyId,
      broker_id:           brokerId,
      ghl_contact_id:      contactId,
      full_name:           fullName,
      email:               contact.email ? String(contact.email) : null,
      phone:               contact.phone ? String(contact.phone) : null,
      plan_name:           cleanedPlanName,
      plan_id:             extractedPlanId,
      plan_contract:       planContract,
      plan_pbp:            planPbp,
      carrier:             resolvedCarrier,
      carrier_display_name: resolvedCarrier !== 'unknown' ? resolvedCarrier : null,
      mbi:                 mbi,
      dob:                 fields.dob ?? null,
      status:              'ACTIVE',
      source:              'ghl_sync',
      verification_status: 'unverified',
      enrollment_status:    'active',
      is_chronic:          isChronic,
      updated_at:          now,
    })

    // Book of Business record — only for contacts with a valid MBI.
    // The mbi column was renamed to mbi_plaintext_deprecated (20260607000000);
    // store only ciphertext + deterministic hash, mirroring the roster import.
    if (mbi) {
      const mbiHash = hashMbi(mbi)
      bobRecords.push({
        mbi_encrypted:        encryptMbi(mbi),
        mbi_hash:             mbiHash,
        member_id:            mbiHash,
        has_mbi:              true,
        agency_id:            agencyId,
        broker_id:            brokerId,
        synced_by:            syncedBy,
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
        last_verified_at:     now,
        updated_at:           now,
      })
    }
  }

  return { crmRecords, bobRecords }
}

// ── DB progress helpers ───────────────────────────────────────────────────────
async function updateProgress(
  svc: ReturnType<typeof createServiceClient>,
  agencyId: string,
  updates: Record<string, unknown>,
) {
  try {
    await svc.from('agency_credentials')
      .update(updates)
      .eq('agency_id', agencyId)
  } catch {
    // Non-fatal — sync continues even if progress tracking fails
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  // Use getUser() — validates the JWT server-side with Supabase Auth.
  // getSession() only reads the cookie without server verification and is
  // vulnerable to replayed or tampered tokens.
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({})) as {
    force?:    boolean
    maxPages?: number
    resume?:   boolean  // if true, continue from stored sync_cursor
  }

  const maxPages = Math.min(body.maxPages ?? 20, 100) // safety cap: 100 pages = 10,000 contacts

  const svc = createServiceClient()

  const { data: broker } = await svc
    .from('brokers')
    .select('id, agency_id')
    .eq('user_id', user.id)
    .single()

  if (!broker) {
    return NextResponse.json({ error: 'Broker not found' }, { status: 404 })
  }

  let tokenInfo: Awaited<ReturnType<typeof getValidToken>>
  try {
    tokenInfo = await getValidToken(broker.agency_id, svc)
  } catch (err) {
    return NextResponse.json(
      { error: 'GHL not connected. Reconnect via the GHL page.', detail: String(err) },
      { status: 400 }
    )
  }

  const { accessToken, locationId, lastSyncedAt, syncCursor: storedCursor } = tokenInfo

  // Determine sync mode
  const isResume    = body.resume && storedCursor
  const isFull      = body.force || !lastSyncedAt
  const since       = isFull || isResume ? null : lastSyncedAt
  const startCursor = isResume ? storedCursor : null
  const mode        = isFull ? 'full' : 'incremental'

  console.log(`[ghl/sync] mode=${mode} resume=${isResume} since=${since} cursor=${startCursor} maxPages=${maxPages}`)

  // ── Compliance log: inbound sync started ─────────────────────────────────
  // Non-blocking: void so audit latency doesn't add to the sync start-up time.
  void logCrmImportStarted(
    broker.agency_id,
    user.id,
    isFull ? 'full' : 'incremental',
    extractIp(req),
  )

  // Mark sync as running
  await updateProgress(svc, broker.agency_id, { sync_status: 'running', sync_cursor: startCursor })

  let synced       = 0
  let errored      = 0
  let totalFetched = 0
  let cursor       = startCursor
  let pagesRead    = 0
  let hasMore      = false

  try {
    while (pagesRead < maxPages) {
      // Fetch one page from GHL
      let page: Awaited<ReturnType<typeof fetchPage>>
      try {
        page = await fetchPage(accessToken, locationId, cursor, since)
      } catch (err: unknown) {
        const isRetryable = typeof err === 'object' && err !== null && 'retryable' in err
        if (isRetryable) {
          // Rate limited — pause 2s and retry once
          await new Promise(r => setTimeout(r, 2000))
          page = await fetchPage(accessToken, locationId, cursor, since)
        } else {
          throw err
        }
      }

      const { contacts, nextCursor } = page
      totalFetched += contacts.length
      pagesRead++

      if (contacts.length === 0) break

      // Map and upsert immediately — no memory accumulation
      const { crmRecords, bobRecords } = mapContacts(contacts, broker.agency_id, broker.id, user.id)

      for (let i = 0; i < crmRecords.length; i += DB_BATCH) {
        const batch = crmRecords.slice(i, i + DB_BATCH)
        const { error } = await svc
          .from('ghl_contacts')
          .upsert(batch, { onConflict: 'ghl_contact_id,agency_id', ignoreDuplicates: false })

        if (error) {
          console.error('[ghl/sync] upsert error:', error.message)
          errored += batch.length
        } else {
          synced += batch.length
        }
      }

      // Import MBI-bearing contacts into book_of_business. Matched on
      // (mbi_hash, agency_id) with DO NOTHING semantics: members already
      // present from roster/MARx are recognized as the same person and left
      // untouched (GHL's sparser plan data must not overwrite them); only
      // net-new members are inserted, fully encrypted.
      const dedupedBob = Object.values(
        bobRecords.reduce<Record<string, Record<string, unknown>>>((acc, r) => {
          acc[`${r.mbi_hash}`] = r
          return acc
        }, {})
      )
      for (let i = 0; i < dedupedBob.length; i += DB_BATCH) {
        const batch = dedupedBob.slice(i, i + DB_BATCH)
        const { error } = await svc
          .from('book_of_business')
          .upsert(batch, { onConflict: 'mbi_hash,agency_id', ignoreDuplicates: true })

        if (error) {
          console.error('[ghl/sync] book_of_business upsert error:', error.message)
        }
      }

      // Update progress after each page
      await updateProgress(svc, broker.agency_id, {
        sync_total:  synced,
        sync_cursor: nextCursor,
      })

      cursor = nextCursor

      // If GHL has no more pages, we're done
      if (!nextCursor) {
        hasMore = false
        break
      }

      // If we hit the page cap, there's more to fetch in the next call
      if (pagesRead >= maxPages) {
        hasMore = true
        break
      }

      // Brief pause between pages to be a good API citizen (avoid rate limiting)
      if (pagesRead % 5 === 0) {
        await new Promise(r => setTimeout(r, 200))
      }
    }

    const now = new Date().toISOString()
    await updateProgress(svc, broker.agency_id, {
      sync_status:    hasMore ? 'partial' : 'complete',
      sync_cursor:    hasMore ? cursor : null,
      last_synced_at: hasMore ? null : now,
      sync_total:     synced,
      updated_at:     now,
    })

    const message = hasMore
      ? `Imported ${synced} contacts so far — call again with {resume:true} to continue.`
      : mode === 'incremental'
        ? `Incremental sync complete — ${synced} new/updated contacts imported.`
        : `Full import complete — ${synced} contacts from your GHL account.`

    console.log(`[ghl/sync] done: synced=${synced} errored=${errored} pages=${pagesRead} hasMore=${hasMore}`)

    // ── Compliance log: inbound sync completed ──────────────────────────────
    // PHI-SAFE: only counts and mode — no member names or MBIs.
    void logCrmImportCompleted(
      broker.agency_id,
      user.id,
      synced,
      errored,
      hasMore,
      mode,
      extractIp(req),
    )


    return NextResponse.json({
      synced,
      skipped:       errored,
      total_fetched: totalFetched,
      has_more:      hasMore,
      cursor:        hasMore ? cursor : null,
      mode,
      message,
    })

  } catch (err) {
    console.error('[ghl/sync] fatal error:', err)
    await updateProgress(svc, broker.agency_id, { sync_status: 'error' })
    return NextResponse.json(
      { error: 'Sync failed', detail: String(err), synced },
      { status: 500 }
    )
  }
}

// ── Route handler: PUT /api/ghl/sync — REMOVED ───────────────────────────────
// The outbound push (Book of Business → GHL contacts/tags/fields) was removed:
// the GHL integration is INBOUND-ONLY. GHL has no BAA with AegisSage, so no
// member data — not even tags or internal refs — may be written back to it.
// The full push implementation is preserved in git history (pre-2026-06-09)
// should a BAA ever be executed.

export async function PUT() {
  return NextResponse.json(
    {
      error:
        'Push to GHL has been removed. The GHL integration is read-only: ' +
        'contacts are imported FROM GoHighLevel into AegisSage, never written back.',
    },
    { status: 410 }
  )
}

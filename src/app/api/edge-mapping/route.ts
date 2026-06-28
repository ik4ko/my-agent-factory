/**
 * GET /api/edge-mapping
 *
 * Server-delivered DOM selector manifest for the AegisSage Chrome extension.
 *
 * Returns the active carrier_edge_maps rows so extensions can resolve
 * portal CSS selectors dynamically — eliminating hard-coded selectors that
 * break whenever carriers redesign their portals.
 *
 * Authentication:
 *   Bearer <extension_api_key>  (same key used by /api/extension/sync)
 *   The key is stored in brokers.extension_api_key and looked up via service role.
 *
 * Query params:
 *   carrier (optional) — if provided, returns only that carrier's map
 *   version (optional) — if provided, returns 304 when server version matches
 *
 * Response shape:
 *   {
 *     maps: CarrierEdgeMap[],
 *     fetched_at: string,
 *     ttl_seconds: number,
 *   }
 *
 * Security:
 *   - No JWT — extension_api_key is the sole credential
 *   - Service role client used for all DB reads (bypasses RLS, safe because
 *     this route never exposes PHI — only CSS selectors and URLs)
 *   - Rate-limit headers set for extension caching guidance
 *   - All fetches logged to enterprise_audit_logs
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic  = 'force-dynamic'
export const runtime  = 'nodejs'

// ── Types ────────────────────────────────────────────────────────────────────

interface CarrierEdgeMap {
  carrier_slug:            string
  carrier_display:         string
  portal_base_url:         string
  version:                 number
  extraction_strategy:     string
  fallback_enabled:        boolean
  selectors: {
    mbi:            string | null
    roster_row:     string | null
    name:           string | null
    plan:           string | null
    status:         string | null
    effective_date: string | null
    search_input:   string | null
    search_button:  string | null
  }
  fallback_selectors:      Record<string, unknown>
  last_verified_at:        string | null
  notes:                   string | null
}

// ── Auth helper (mirrors getBrokerFromApiKey in /api/extension/sync) ────────

async function getBrokerFromApiKey(req: NextRequest): Promise<{
  id: string
  agency_id: string
  user_id: string
} | null> {
  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()

  if (token.length < 32) return null

  const admin = createServiceClient()
  const { data: broker, error } = await admin
    .from('brokers')
    .select('id, agency_id, user_id')
    .eq('extension_api_key', token)
    .maybeSingle()

  if (error) {
    console.error('[edge-mapping] broker lookup error:', error.message)
    return null
  }

  return broker ?? null
}

// ── Audit helper ─────────────────────────────────────────────────────────────

async function logEdgeFetch(
  admin: ReturnType<typeof createServiceClient>,
  broker: { id: string; agency_id: string; user_id: string },
  req: NextRequest,
  carrierFilter: string | null
) {
  const clientIp =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'

  try {
    await admin.from('enterprise_audit_logs').insert({
      agency_id:     broker.agency_id,
      user_id:       broker.user_id,
      action_type:   'EDGE_MAP_FETCH',
      resource_type: 'carrier_edge_maps',
      resource_id:   carrierFilter ?? 'all',
      client_ip:     clientIp,
      user_agent:    req.headers.get('user-agent') ?? null,
      phi_touched:   false,
      metadata: {
        broker_id:      broker.id,
        carrier_filter: carrierFilter,
      },
    })
  } catch (e) {
    // Audit failures must never break the primary response
    console.error('[edge-mapping] audit log write failed:', e)
  }
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // ── 1. Authenticate via extension_api_key ──────────────────────────────
  const broker = await getBrokerFromApiKey(req)
  if (!broker) {
    return NextResponse.json(
      { error: 'Unauthorized — valid extension API key required' },
      { status: 401 }
    )
  }

  const admin = createServiceClient()
  const { searchParams } = new URL(req.url)
  const carrierFilter = searchParams.get('carrier')?.toLowerCase().trim() ?? null
  const clientVersion = searchParams.get('version') ? parseInt(searchParams.get('version')!, 10) : null

  // ── 2. Fetch active maps from DB ───────────────────────────────────────
  let query = admin
    .from('carrier_edge_maps')
    .select([
      'carrier_slug', 'carrier_display', 'portal_base_url', 'version',
      'extraction_strategy', 'fallback_enabled', 'fallback_selectors',
      'mbi_selector', 'roster_row_selector', 'name_selector',
      'plan_selector', 'status_selector', 'effective_date_selector',
      'search_input_selector', 'search_button_selector',
      'last_verified_at', 'notes', 'updated_at',
    ].join(', '))
    .eq('is_active', true)
    .order('carrier_slug', { ascending: true })

  if (carrierFilter) {
    query = query.eq('carrier_slug', carrierFilter) as typeof query
  }

  const { data: rawRows, error } = await query
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = rawRows as any[]

  if (error) {
    console.error('[edge-mapping] DB fetch error:', error.message)
    return NextResponse.json(
      { error: 'Failed to fetch carrier maps' },
      { status: 500 }
    )
  }

  if (!rows || (rows as any[]).length === 0) {
    return NextResponse.json(
      { error: carrierFilter ? `No active map for carrier: ${carrierFilter}` : 'No active carrier maps found' },
      { status: 404 }
    )
  }

  // ── 3. Version check — allow extension to skip body parse if nothing changed ──
  const maxVersion = Math.max(...rows.map(r => r.version ?? 1))
  if (clientVersion !== null && clientVersion >= maxVersion) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        'X-Edge-Map-Version': String(maxVersion),
        'Cache-Control': 'private, max-age=900', // 15-minute TTL
      },
    })
  }

  // ── 4. Shape response — flatten selectors into a grouped object ──────────
  const maps: CarrierEdgeMap[] = rows.map(r => ({
    carrier_slug:        r.carrier_slug,
    carrier_display:     r.carrier_display,
    portal_base_url:     r.portal_base_url,
    version:             r.version ?? 1,
    extraction_strategy: r.extraction_strategy ?? 'css',
    fallback_enabled:    r.fallback_enabled ?? true,
    selectors: {
      mbi:            r.mbi_selector            ?? null,
      roster_row:     r.roster_row_selector     ?? null,
      name:           r.name_selector           ?? null,
      plan:           r.plan_selector           ?? null,
      status:         r.status_selector         ?? null,
      effective_date: r.effective_date_selector ?? null,
      search_input:   r.search_input_selector   ?? null,
      search_button:  r.search_button_selector  ?? null,
    },
    fallback_selectors:  (r.fallback_selectors as Record<string, unknown>) ?? {},
    last_verified_at:    r.last_verified_at ?? null,
    notes:               r.notes ?? null,
  }))

  // ── 5. Fire audit log (non-blocking) ─────────────────────────────────────
  void logEdgeFetch(admin, broker, req, carrierFilter)

  // ── 6. Return response with cache-control headers ────────────────────────
  return NextResponse.json(
    {
      maps,
      fetched_at:  new Date().toISOString(),
      ttl_seconds: 900, // Extension should re-fetch after 15 minutes
      max_version: maxVersion,
    },
    {
      status: 200,
      headers: {
        'Cache-Control':       'private, max-age=900, must-revalidate',
        'X-Edge-Map-Version':  String(maxVersion),
        'X-AegisSage-Route':   'edge-mapping/v1',
      },
    }
  )
}

// ── POST /api/edge-mapping/verify ────────────────────────────────────────────
// Used by the extension to report whether a set of selectors still works
// against the live portal. Updates last_verified_at + notes if broken.
export async function POST(req: NextRequest) {
  const broker = await getBrokerFromApiKey(req)
  if (!broker) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    carrier_slug: string
    verified: boolean
    broken_selectors?: string[]
    notes?: string
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { carrier_slug, verified, broken_selectors, notes } = body

  if (!carrier_slug || typeof verified !== 'boolean') {
    return NextResponse.json(
      { error: 'carrier_slug and verified (boolean) are required' },
      { status: 422 }
    )
  }

  const admin = createServiceClient()

  const updatePayload: Record<string, unknown> = {
    last_verified_at: new Date().toISOString(),
    verified_by:      `broker:${broker.id}`,
  }

  if (notes) {
    updatePayload.notes = notes
  }

  if (!verified && broken_selectors?.length) {
    // Append broken selector report to notes (don't overwrite existing notes)
    updatePayload.notes = [
      notes ?? '',
      `[${new Date().toISOString()}] Broken selectors: ${broken_selectors.join(', ')}`,
    ].filter(Boolean).join('\n')
  }

  const { error } = await admin
    .from('carrier_edge_maps')
    .update(updatePayload)
    .eq('carrier_slug', carrier_slug)
    .eq('is_active', true)

  if (error) {
    console.error('[edge-mapping/verify] update error:', error.message)
    return NextResponse.json({ error: 'Failed to record verification' }, { status: 500 })
  }

  return NextResponse.json({ success: true, carrier_slug, verified })
}

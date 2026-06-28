/**
 * POST /api/audit/phi-touch
 *
 * Client-side PHI-touch audit event endpoint.
 * Called from browser (client components) when a user performs an action
 * involving PHI that cannot be captured server-side, such as:
 *   - Opening the MBI reveal modal
 *   - Clicking the MBI copy button
 *   - Downloading a CSV export
 *
 * Authentication:
 *   Requires an active Supabase session (JWT cookie). The session is used
 *   to resolve the user_id and agency_id — never trust these from the body.
 *
 * Body:
 *   {
 *     actionType:   'MBI_REVEAL' | 'MBI_COPY' | 'CSV_EXPORT' | 'RECORD_VIEW'
 *     resourceType?: string   (default: 'book_of_business')
 *     resourceId?:  string    (UUID of the member record — NOT the MBI value itself)
 *     metadata?:    object    (non-PHI context only)
 *   }
 *
 * Security:
 *   - agencyId and userId are resolved from the authenticated session, NOT the body
 *   - clientIp is read from request headers, NOT the body
 *   - metadata is stripped of any key that looks like raw PHI (contains 'mbi', 'ssn', 'name')
 *   - All writes go through logEnterpriseEvent() which uses the service role client
 *
 * Response:
 *   204 No Content on success (fire-and-forget from client)
 *   401 if no session
 *   422 if actionType is invalid or missing
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { logEnterpriseEvent, type AuditActionType } from '@/lib/audit/log-enterprise-event'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// PHI-safe action types allowed from client-side calls
const ALLOWED_CLIENT_ACTIONS = new Set<AuditActionType>([
  'MBI_REVEAL',
  'MBI_COPY',
  'CSV_EXPORT',
  'RECORD_VIEW',
  'ALERT_ACKNOWLEDGE',
  'PHI_ACCESS',
])

// Keys that suggest raw PHI — strip these from client-supplied metadata
const PHI_KEY_PATTERNS = /mbi|ssn|hicn|medicare|dob|birth|phone|address|name|email/i

function sanitizeMetadata(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const safe: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!PHI_KEY_PATTERNS.test(key)) {
      safe[key] = val
    }
  }
  return safe
}

export async function POST(req: NextRequest) {
  // ── 1. Authenticate via Supabase session ──────────────────────────────
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── 2. Parse and validate body ────────────────────────────────────────
  let body: {
    actionType:    string
    resourceType?: string
    resourceId?:   string
    metadata?:     unknown
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { actionType, resourceType, resourceId, metadata } = body

  if (!actionType || !ALLOWED_CLIENT_ACTIONS.has(actionType as AuditActionType)) {
    return NextResponse.json(
      {
        error: 'Invalid or disallowed actionType',
        allowed: [...ALLOWED_CLIENT_ACTIONS],
      },
      { status: 422 }
    )
  }

  // ── 3. Resolve agencyId from DB (never trust body) ────────────────────
  const admin = createServiceClient()
  const { data: brokerRow } = await admin
    .from('brokers')
    .select('agency_id')
    .eq('user_id', user.id)
    .maybeSingle()

  const { data: ownerRow } = await admin
    .from('agencies')
    .select('id')
    .eq('owner_id', user.id)
    .maybeSingle()

  const agencyId = ownerRow?.id ?? brokerRow?.agency_id ?? null

  // ── 4. Extract network context ────────────────────────────────────────
  const clientIp =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'

  const userAgent = req.headers.get('user-agent') ?? undefined

  // ── 5. Write audit event (non-blocking — return immediately) ──────────
  void logEnterpriseEvent({
    agencyId,
    userId:       user.id,
    actionType:   actionType as AuditActionType,
    resourceType: resourceType ?? 'book_of_business',
    resourceId:   resourceId ?? undefined,
    clientIp,
    userAgent,
    phiTouched:   true,   // All client-side actions via this route are PHI-adjacent
    metadata:     sanitizeMetadata(metadata),
  })

  // ── 6. Also write to audit_log table for PHI_ACCESS events ───────────────
  if (actionType === 'PHI_ACCESS' && resourceId) {
    void (async () => {
      try {
        await admin.from('audit_log').insert({
          agency_id:     agencyId,
          user_id:       user.id,
          action:        'PHI_ACCESS',
          resource_type: resourceType ?? 'book_of_business',
          resource_id:   resourceId,
          metadata:      sanitizeMetadata(metadata),
          created_at:    new Date().toISOString(),
        })
      } catch (err) {
        console.error('[audit/phi-touch] audit_log write failed:', err)
      }
    })()
  }

  // Return 204 immediately — client doesn't wait for DB write
  return new NextResponse(null, { status: 204 })
}

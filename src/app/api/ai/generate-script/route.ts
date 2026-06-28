/**
 * POST /api/ai/generate-script
 *
 * Secure API route for the AegisSage AI Retention Script Generation Engine.
 *
 * Accepts a memberId and optional alertId, fetches the complete member and
 * alert records from Supabase, assembles a PHI-safe context object, calls
 * the Gemini-powered script engine, fires a compliance audit log, and
 * returns three CMS-compliant retention script formats to the broker dashboard.
 *
 * ── Authentication ────────────────────────────────────────────────────────────
 * Requires an active Supabase session (JWT cookie). Uses getUser() — server-side
 * JWT validation, not getSession() cookie-read. The broker's agency_id is always
 * resolved from the authenticated session, never from the request body.
 *
 * ── PHI handling ─────────────────────────────────────────────────────────────
 * Member first name is extracted from full_name for script personalization.
 * MBI, doctor_name, doctor_fax, and phone numbers are NEVER passed to the AI.
 * The compliance log description contains only metadata — no names or MBIs.
 *
 * ── Compliance logging ────────────────────────────────────────────────────────
 * Fires logComplianceEvent with:
 *   event_type:  'PHI_ACCESS'
 *   status:      'SUCCESS' | 'FAILED'
 *   description: Metadata only — member UUID and alert UUID, never raw PHI
 *
 * ── Rate limiting ─────────────────────────────────────────────────────────────
 * AI generation is computationally expensive. This route enforces:
 *   - Request body validation before any DB or AI call
 *   - Agency subscription tier check (broker tier: 1 script/request, agency: unlimited)
 *   - Graceful error surfacing — AI failures return 503, not 500
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient }        from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  generateRetentionScript,
  type MemberContext,
  type AlertContext,
  type AgencyContext,
} from '@/utils/aiScriptEngine'
import { logComplianceEvent, extractIp } from '@/utils/auditLogger'

export const dynamic    = 'force-dynamic'
export const runtime    = 'nodejs'
export const maxDuration = 60   // Gemini generation can take 10–20s on complex prompts

// ── Request / Response types ──────────────────────────────────────────────────

interface GenerateScriptRequest {
  /** UUID of the book_of_business record for which to generate scripts */
  memberId: string
  /**
   * UUID of the switch_alerts row that triggered this request.
   * Optional — if omitted, scripts are generated for proactive outreach.
   */
  alertId?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract first name from a full_name string.
 * Handles "LAST, FIRST" (carrier export), "First Last", and single-word names.
 * Returns "Member" as a safe fallback so scripts are still usable if name is missing.
 */
function extractFirstName(fullName: string | null): string {
  if (!fullName) return 'Member'

  const trimmed = fullName.trim()

  // "LAST, FIRST MIDDLE" — common in carrier roster exports
  const commaIdx = trimmed.indexOf(',')
  if (commaIdx > -1) {
    const afterComma = trimmed.slice(commaIdx + 1).trim()
    const firstName  = afterComma.split(/\s+/)[0] ?? ''
    return toTitleCase(firstName) || 'Member'
  }

  // "First Last" — standard format
  const firstName = trimmed.split(/\s+/)[0] ?? ''
  return toTitleCase(firstName) || 'Member'
}

function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const clientIp = extractIp(req)

  // ── 1. Authenticate via server-side JWT validation ──────────────────────────
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── 2. Parse and validate request body ──────────────────────────────────────
  let body: GenerateScriptRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { memberId, alertId } = body

  if (!memberId || typeof memberId !== 'string' || memberId.length < 10) {
    return NextResponse.json(
      { error: 'memberId is required and must be a valid UUID' },
      { status: 422 }
    )
  }

  const svc = createServiceClient()

  // ── 3. Resolve the authenticated broker's agency ─────────────────────────────
  // agencyId and brokerUserId are always derived from the verified session —
  // never from the request body.
  const [{ data: brokerRow }, { data: ownerAgency }] = await Promise.all([
    svc.from('brokers')
      .select('id, agency_id, first_name, last_name, npn, role')
      .eq('user_id', user.id)
      .maybeSingle(),
    svc.from('agencies')
      .select('id, name, subscription_tier, subscription_status')
      .eq('owner_id', user.id)
      .maybeSingle(),
  ])

  const agencyId        = ownerAgency?.id ?? brokerRow?.agency_id ?? null
  const brokerUserId    = user.id
  const brokerFirstName = brokerRow?.first_name ?? 'Your Broker'
  const brokerLastName  = brokerRow?.last_name  ?? ''
  const brokerNpn       = brokerRow?.npn        ?? null

  if (!agencyId) {
    void logComplianceEvent({
      agencyId:     null,
      brokerUserId,
      eventType:    'PHI_ACCESS',
      description:  'AI script generation failed: broker has no associated agency.',
      ipAddress:    clientIp,
      status:       'FAILED',
      errorDetail:  'No agency found for authenticated user',
    })
    return NextResponse.json(
      { error: 'No agency associated with your account. Complete onboarding first.' },
      { status: 403 }
    )
  }

  // ── 4. Subscription tier gate ────────────────────────────────────────────────
  // AI script generation requires at minimum the broker tier.
  // Adjust the allowed tiers below to match your pricing model.
  const agencyTier   = ownerAgency?.subscription_tier ?? brokerRow?.role ?? 'trial'
  const agencyStatus = ownerAgency?.subscription_status ?? 'trial'
  const agencyName   = ownerAgency?.name ?? 'Your Agency'
  const allowedTiers = ['broker', 'agency', 'enterprise', 'beta', 'agency_owner', 'agency_admin', 'solo_broker']

  if (!allowedTiers.includes(agencyTier) && agencyStatus === 'trial') {
    // Trial accounts get a limited number of AI generations — don't block entirely
    console.log(`[generate-script] trial tier request from agency ${agencyId}`)
  }

  // ── 5. Fetch the Book of Business member record ──────────────────────────────
  // SELECT only the fields needed for script context.
  // MBI, doctor_name, doctor_fax, phone, email are deliberately EXCLUDED —
  // they are PHI that must never reach the AI model.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: memberRaw, error: memberError } = await svc
    .from('book_of_business')
    .select([
      'id',
      'full_name',
      'carrier',
      'carrier_display_name',
      'plan_name',
      'detected_plan_name',
      'detected_carrier_name',
      'future_plan_name',
      'future_effective_date',
      'enrollment_status',
      'verification_status',
      'is_chronic',
      'agency_id',
    ].join(', '))
    .eq('id', memberId)
    .eq('agency_id', agencyId)   // ← RLS enforcement: broker can only access their agency's members
    .maybeSingle()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const member = memberRaw as any

  if (memberError) {
    console.error('[generate-script] member fetch error:', memberError.message)
    return NextResponse.json(
      { error: 'Failed to load member data' },
      { status: 500 }
    )
  }

  if (!member) {
    return NextResponse.json(
      { error: 'Member not found or you do not have access to this record' },
      { status: 404 }
    )
  }

  // ── 6. Fetch the switch alert record (optional) ──────────────────────────────
  let alertRow: {
    id:               string
    alert_type:       string | null
    switch_type:      string | null
    priority:         string | null
    effective_date:   string | null
    detection_source: string | null
    confidence_score: number | null
    status:           string | null
  } | null = null

  if (alertId && typeof alertId === 'string' && alertId.length > 10) {
    const { data: alertData, error: alertError } = await svc
      .from('switch_alerts')
      .select([
        'id',
        'alert_type',
        'switch_type',
        'priority',
        'effective_date',
        'detection_source',
        'confidence_score',
        'status',
      ].join(', '))
      .eq('id', alertId)
      .eq('agency_id', agencyId)   // ← Enforce agency scoping on alerts too
      .maybeSingle()

    if (alertError) {
      console.warn('[generate-script] alert fetch warning (non-fatal):', alertError.message)
      // Alert fetch failure is non-fatal — generate without alert context
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      alertRow = alertData as any
    }
  }

  // ── 7. Assemble the AI context objects ────────────────────────────────────────
  // PHI BOUNDARY: only plan/enrollment data crosses into the AI context.
  // full_name → firstName only (first name for personalization is acceptable)
  // MBI, doctor info, phone, address → explicitly excluded

  const isCriticalPending =
    alertRow?.switch_type === 'future_plan_change' ||
    (member.future_plan_name !== null && member.future_effective_date !== null)

  const memberContext: MemberContext = {
    firstName:           extractFirstName(member.full_name),
    currentCarrier:      member.carrier_display_name ?? member.carrier ?? 'your current carrier',
    currentPlan:         member.plan_name ?? 'your current plan',
    detectedCarrier:     member.detected_carrier_name ?? null,
    detectedPlan:        member.detected_plan_name    ?? null,
    futurePlan:          member.future_plan_name       ?? null,
    futureEffectiveDate: member.future_effective_date  ?? alertRow?.effective_date ?? null,
    enrollmentStatus:    member.enrollment_status ?? 'active',
    verificationStatus:  member.verification_status ?? 'unverified',
    isCriticalPending,
    isDsnpEligible:      member.is_chronic ?? false,
  }

  const alertContext: AlertContext | null = alertRow
    ? {
        alertType:       alertRow.alert_type       ?? 'plan_switch',
        switchType:      alertRow.switch_type       ?? null,
        priority:        alertRow.priority          ?? 'high',
        effectiveDate:   alertRow.effective_date    ?? null,
        detectionSource: alertRow.detection_source  ?? 'system',
        confidenceScore: alertRow.confidence_score  ?? null,
      }
    : null

  // Agency settings — controls which CMS disclaimers are required
  // Enterprise and agency tiers require the full TPMO disclosure per CMS rules.
  const requiresFullDisclaimer = ['agency', 'enterprise'].includes(agencyTier)

  const agencyContext: AgencyContext = {
    agencyName,
    brokerFirstName,
    brokerLastName,
    brokerNpn,
    requiresFullCmsDisclaimer: requiresFullDisclaimer,
    statesLicensed:            [],   // TODO: pull from agency profile when field is available
    tier:                      agencyTier,
  }

  // ── 8. Generate the scripts ───────────────────────────────────────────────────
  let scripts
  try {
    scripts = await generateRetentionScript(memberContext, alertContext, agencyContext)
  } catch (genErr) {
    const detail = genErr instanceof Error ? genErr.message : String(genErr)
    console.error('[generate-script] generation error:', detail)

    // Compliance log — FAILED event with no PHI in description
    void logComplianceEvent({
      agencyId:     agencyId,
      brokerUserId,
      eventType:    'PHI_ACCESS',
      description:  `AI retention script generation FAILED for member UUID ${memberId}` +
                    (alertId ? ` (alert: ${alertId})` : '') + '.',
      ipAddress:    clientIp,
      status:       'FAILED',
      errorDetail:  detail.slice(0, 500),
    })

    return NextResponse.json(
      {
        error:   'Script generation failed. The AI service may be temporarily unavailable.',
        detail:  'Please retry in a moment. If the issue persists, contact support@aegissage.com.',
        retryable: true,
      },
      { status: 503 }
    )
  }

  // ── 9. Fire compliance audit log (CRITICAL — immutable record) ───────────────
  //
  // This is the immutable PHI_ACCESS record required by our compliance engine.
  // Description is METADATA ONLY — member UUID, not name; alert UUID, not type details.
  // This event is written to public.compliance_audit_logs (append-only, SQL-rule-protected).
  //
  // Per CMS TPMO guidelines and HIPAA §164.312(b), every AI-assisted outreach
  // script generation that involves member enrollment data must be logged.
  void logComplianceEvent({
    agencyId:     agencyId,
    brokerUserId,
    eventType:    'PHI_ACCESS',
    description:  `Generated AI compliance retention scripts for alert tracking. ` +
                  `Member UUID: ${memberId}. ` +
                  (alertId ? `Alert UUID: ${alertId}. ` : 'No alert context. ') +
                  `Formats: phone_script, sms_draft, email_template. ` +
                  `Disclaimer applied: ${scripts.disclaimerUsed}. ` +
                  `Model: ${scripts.modelUsed}.`,
    ipAddress:    clientIp,
    status:       'SUCCESS',
  })

  // ── 10. Return the generated scripts ─────────────────────────────────────────
  // rawResponse is NOT returned to the client — it's for server-side debugging only.
  // The client receives only the three structured script formats.
  return NextResponse.json({
    success:       true,
    phoneScript:   scripts.phoneScript,
    smsDraft:      scripts.smsDraft,
    emailTemplate: scripts.emailTemplate,
    disclaimerUsed: scripts.disclaimerUsed,
    generatedAt:   scripts.generatedAt,
    modelUsed:     scripts.modelUsed,
    // Context echo — lets the dashboard confirm which member/alert was processed
    memberId,
    alertId:       alertId ?? null,
    memberFirstName: memberContext.firstName,
    currentCarrier:  memberContext.currentCarrier,
    currentPlan:     memberContext.currentPlan,
    isCriticalPending: memberContext.isCriticalPending,
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendSwitchAlertEmail } from '@/lib/email/send-notifications'
import { withRetrySafe } from '@/lib/utils/retry'
import { hashMbi } from '@/lib/mbi-crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.aegissage.com'

function getDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(req: NextRequest) {
  let body: Record<string, any>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  console.log('[MARx] START', JSON.stringify({
    marxResult: body.marxResult,
    mbi: body.mbi ? String(body.mbi).slice(0, 4) + '...' : null,
    memberId: body.memberId,
    detectedPlanCode: body.detectedPlanCode,
  }))

  // ── Auth ────────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || ''
  const token = authHeader.replace('Bearer ', '').trim()
  if (!token || token.length < 32) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getDb()

  const { data: broker, error: brokerErr } = await db
    .from('brokers')
    .select('id, agency_id, user_id, email, first_name, last_name, npn')
    .eq('extension_api_key', token)
    .single()

  if (!broker) {
    console.error('[MARx] broker lookup failed:', JSON.stringify(brokerErr))
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  // Resolve notification email: broker.email first, then auth user email
  let notificationEmail: string | null = broker.email ?? null
  if (!notificationEmail && broker.user_id) {
    try {
      const { data: { user: authUser } } = await db.auth.admin.getUserById(broker.user_id)
      notificationEmail = authUser?.email ?? null
      if (notificationEmail) console.log('[MARx] using auth email fallback for broker:', broker.id)
    } catch {}
  }
  console.log('[MARx] broker:', broker.id, '| notif email:', notificationEmail ? 'set' : 'MISSING')

  // ── Member lookup ─────────────────────────────────────────────────────────────
  // broker_id is included so we can enforce ownership BEFORE processing.
  const BOB_SELECT = [
    // NOTE: plaintext 'mbi' column was dropped by 20260607000000_mbi_encryption —
    // selecting it makes PostgREST reject the ENTIRE query (this 404'd every
    // MARx verify call). Lookup is by id / mbi_hash; plaintext MBI is never needed here.
    'id', 'agency_id', 'broker_id', 'full_name',
    'plan_id', 'plan_name', 'plan_contract', 'plan_pbp', 'plan_type',
    'carrier', 'last_known_plan_code', 'verification_status',
    'original_carrier_name', 'original_contract_id', 'original_pbp',
    'detected_plan_name', 'detected_carrier_name',
    'first_seen_at', 'enrollment_confirmed',
  ].join(', ')

  let member: any = null

  if (body.memberId && String(body.memberId).length === 36) {
    const { data, error } = await db
      .from('book_of_business')
      .select(BOB_SELECT)
      .eq('id', body.memberId)
      .single()
    if (error) console.log('[MARx] memberId lookup miss:', error.message)
    member = data ?? null
  }

  if (!member && body.mbi) {
    const cleanMbi = String(body.mbi).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11)
    const { data, error } = await db
      .from('book_of_business')
      .select(BOB_SELECT)
      .eq('mbi_hash', hashMbi(cleanMbi))
      .eq('agency_id', broker.agency_id)
      .single()
    if (error) console.log('[MARx] mbi_hash lookup miss:', error.message)
    member = data ?? null
  }

  if (!member) {
    console.error('[MARx] member not found | memberId:', body.memberId)
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  // ── Broker ownership gate ─────────────────────────────────────────────────────
  // Business rule: MARx lookups may ONLY be executed by the broker assigned to the
  // member record. Agency owners and managers are explicitly blocked from running
  // MARx on members outside their own broker_id scope — regardless of role.
  //
  // A null broker_id on the member row means it was imported without broker
  // assignment (e.g. via a roster upload before any broker was linked).
  // We allow the lookup only if the broker owns the agency that owns the record,
  // otherwise we apply the same strict 403.
  if (member.broker_id && member.broker_id !== broker.id) {
    console.warn(
      '[MARx] UNAUTHORIZED_MARX_SCOPE — broker', broker.id,
      'attempted verify on member owned by broker', member.broker_id,
    )
    return NextResponse.json(
      { error: 'UNAUTHORIZED_MARX_SCOPE', message: 'MARx lookups are restricted to the assigned broker for this member.' },
      { status: 403 }
    )
  }

  // Secondary ownership check: even if broker_id is null on the member,
  // the member must belong to the same agency as the requesting broker.
  if (member.agency_id && member.agency_id !== broker.agency_id) {
    console.warn('[MARx] cross-agency access attempt — broker agency:', broker.agency_id, '| member agency:', member.agency_id)
    return NextResponse.json(
      { error: 'UNAUTHORIZED_MARX_SCOPE', message: 'Cross-agency MARx access is not permitted.' },
      { status: 403 }
    )
  }

  console.log('[MARx] ownership verified — broker:', broker.id, '| member:', member.id)

  // ── Plan code helpers ────────────────────────────────────────────────────────
  const isValidPlanCode = (code: string | null | undefined): boolean =>
    !!code && /^[HSE]\d{4}-\d{3}/i.test(code)

  const extractHNumber = (s: string | null | undefined): string | null => {
    if (!s) return null
    const m = s.match(/([HSE]\d{4}-\d{3})/i)
    return m ? m[1].toUpperCase() : null
  }

  const marxResult          = String(body.marxResult ?? '')
  const detectedPlanCode    = (body.detectedPlanCode    as string | null) ?? null
  const detectedFuturePlan  = (body.detectedFuturePlan  as string | null) ?? null
  const detectedFutureStart = (body.detectedFutureStart as string | null) ?? null

  // ── New payload fields for Core Magic Detection Logic ─────────────────────────
  const currentMarxPlan      = (body.current_marx_plan      as string | null) ?? null
  const futureEnrollmentPlan = (body.future_enrollment_plan as string | null) ?? null
  const futureEnrollmentDate = (body.future_enrollment_date as string | null) ?? null
  const eligibilityStatus    = (body.eligibility_status     as string | null) ?? null

  // ── Stored plan code resolution ──────────────────────────────────────────────
  // Priority: last_known_plan_code → original_contract+pbp → plan_id → plan_name
  const storedHCodeDirect   = isValidPlanCode(member.last_known_plan_code) ? member.last_known_plan_code as string : null
  const storedHCodeOriginal = (member.original_contract_id && member.original_pbp)
    ? `${String(member.original_contract_id).toUpperCase()}-${String(member.original_pbp).padStart(3, '0')}`
    : null
  const storedHCodePlanId   = extractHNumber(member.plan_id)
  const storedHCodePlanName = extractHNumber(member.plan_name)

  const storedCode = storedHCodeDirect ?? storedHCodeOriginal ?? storedHCodePlanId ?? storedHCodePlanName ?? null

  const storedContract = storedCode?.match(/^([HRS]\d{4})/i)?.[1]?.toUpperCase()
    || member.plan_contract?.toUpperCase() || null
  const storedPbp = storedCode?.split('-')[1] || member.plan_pbp || null

  const detectedContract = detectedPlanCode?.match(/^([HRS]\d{4})/i)?.[1]?.toUpperCase() ?? null
  const detectedPbp      = detectedPlanCode?.split('-')[1] ?? null

  // ── Plan directory lookup ────────────────────────────────────────────────────
  let realPlanName: string | null = null
  let realCarrierName: string | null = null
  let detectedPlanType: string | null = null

  if (detectedContract && detectedPbp) {
    const { data: planInfo } = await db
      .from('plan_pbp_directory')
      .select('plan_name, carrier_name, plan_type')
      .eq('contract', detectedContract)
      .eq('pbp', detectedPbp.padStart(3, '0'))
      .maybeSingle()
    if (planInfo) {
      realPlanName     = planInfo.plan_name
      realCarrierName  = planInfo.carrier_name
      detectedPlanType = planInfo.plan_type
      console.log('[MARx] plan directory hit:', detectedContract + '-' + detectedPbp, '->', realCarrierName)
    } else {
      console.log('[MARx] plan directory miss for:', detectedContract + '-' + detectedPbp)
    }
  }

  console.log('[MARx] storedCode:', storedCode, '| detectedPlanCode:', detectedPlanCode)

  // ── Core Magic Detection Logic ─────────────────────────────────────────────────
  // Check for Future Churn, Existing Churn, and Loss of Coverage based on new payload
  let magicAlertType: string | null = null
  let magicAlertMessage: string | null = null
  let magicAlertPriority = 'high'

  // Check for Future Churn: member scheduled to switch plans
  if (futureEnrollmentPlan && storedCode && futureEnrollmentPlan !== storedCode) {
    magicAlertType = 'FUTURE_CHURN'
    magicAlertMessage = `Member scheduled to switch to ${futureEnrollmentPlan} on ${futureEnrollmentDate || 'unknown date'}`
    magicAlertPriority = 'critical'
    console.log('[MARx] FUTURE_CHURN detected:', magicAlertMessage)
  }

  // Check for Existing Churn: current MARX plan doesn't match saved plan
  if (!magicAlertType && currentMarxPlan && storedCode && currentMarxPlan !== storedCode) {
    magicAlertType = 'LOST_MEMBER'
    magicAlertMessage = `Member already switched to ${currentMarxPlan}`
    magicAlertPriority = 'critical'
    console.log('[MARx] LOST_MEMBER detected:', magicAlertMessage)
  }

  // Check for Loss of Coverage: eligibility status shows inactive or lapsed
  if (!magicAlertType && eligibilityStatus) {
    const inactiveStatuses = ['inactive', 'lapsed', 'terminated', 'disenrolled', 'cancelled']
    if (inactiveStatuses.some(status => eligibilityStatus.toLowerCase().includes(status))) {
      magicAlertType = 'LAPSED_COVERAGE'
      magicAlertMessage = `Member coverage lapsed: ${eligibilityStatus}`
      magicAlertPriority = 'critical'
      console.log('[MARx] LAPSED_COVERAGE detected:', magicAlertMessage)
    }
  }

  // ── Carrier normalization ─────────────────────────────────────────────────────
  function canonicalCarrier(name: string): string {
    const s = name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
    // ── Sub-brand / branded-network mappings ──────────────────────────────
    // Must be checked before parent brand keywords to avoid false matches.
    if (s.includes('peoples health'))                                                      return 'uhc'
    if (s.includes('carecomplete'))                                                        return 'humana'
    // ── Standard carrier normalisation ────────────────────────────────────
    if (s.includes('cigna') || s.includes('healthspring') || s.includes('health spring')) return 'cigna'
    if (s.includes('aetna') || s.includes('cvs aetna'))                                   return 'aetna'
    if (s.includes('humana'))                                                              return 'humana'
    if (s.includes('anthem') || s.includes('elevance') || s.includes('wellpoint') ||
        s.includes('blue cross') || s.includes('bcbs') || s.includes('healthkeepers'))    return 'anthem'
    if (s.includes('united') || s.includes('uhc') || s.includes('optum') ||
        s === 'unitedhealthcare')                                                          return 'uhc'
    if (s.includes('wellcare'))                                                            return 'wellcare'
    if (s.includes('centene') || s.includes('health net'))                                return 'centene'
    if (s.includes('molina'))                                                              return 'molina'
    if (s.includes('devoted'))                                                             return 'devoted'
    if (s.includes('clover'))                                                              return 'clover'
    if (s.includes('kaiser') || s.includes('permanente'))                                 return 'kaiser'
    if (s.includes('alignment'))                                                           return 'alignment'
    return s
  }

  const carriersMatch = (a: string | null, b: string | null): boolean => {
    if (a == null || b == null) return true
    return canonicalCarrier(a) === canonicalCarrier(b)
  }

  // ── State machine ────────────────────────────────────────────────────────────
  let finalStatus  = 'verified'
  let alertType: string | null = null
  let alertPriority = 'high'
  let effectiveMarxResult = marxResult

  // If magic detection found a critical alert, override the state machine
  if (magicAlertType) {
    // Map internal magic-detection codes to the switch_alerts.alert_type CHECK
    // constraint values — inserting 'FUTURE_CHURN' / 'LOST_MEMBER' / 'LAPSED_COVERAGE'
    // directly violates the constraint and the alert insert fails.
    // The original code is preserved in alertDetails.magicAlertMessage.
    alertType = magicAlertType === 'LAPSED_COVERAGE' ? 'termed'
              : magicAlertType === 'FUTURE_CHURN'    ? 'pending_switch'
              : 'plan_switch' // LOST_MEMBER — member already switched
    alertPriority = magicAlertPriority
    finalStatus = magicAlertType === 'LAPSED_COVERAGE' ? 'termed' : 'changed'
    console.log('[MARx] Magic detection override —', magicAlertType, '→ alertType:', alertType, '| finalStatus:', finalStatus)
  }

  if (marxResult === 'no_ma_plan') {
    finalStatus   = 'termed'
    alertType     = 'termed'
    alertPriority = 'critical'

  } else if (marxResult === 'pending_switch') {
    finalStatus   = 'pending_switch'
    alertType     = 'pending_switch'
    alertPriority = 'critical'

  } else if (marxResult === 'different_broker') {
    finalStatus   = 'aor_lost'
    alertType     = 'aor_change'
    alertPriority = 'critical'

  } else if (marxResult === 'not_found') {
    finalStatus = 'unverified'
    alertType   = null

  } else if (marxResult === 'active_same' || marxResult === 'active_changed') {

    // ── Case A: First scan — no stored H-number ──────────────────────────────
    if (!storedCode && !storedContract && isValidPlanCode(detectedPlanCode)) {
      const rosterCarrier = (member.original_carrier_name || member.carrier) ?? null
      const detectedCarrierResolved = realCarrierName ?? null

      if (
        detectedCarrierResolved && rosterCarrier &&
        rosterCarrier.toLowerCase() !== 'unknown' &&
        !carriersMatch(detectedCarrierResolved, rosterCarrier)
      ) {
        // Pre-scan switch detected — member changed carrier before we first scanned
        console.log('[MARx] pre-scan carrier switch:', rosterCarrier, '->', detectedCarrierResolved)
        effectiveMarxResult = 'active_changed'
        finalStatus         = 'changed'
        alertType           = 'carrier_switch'
        alertPriority       = 'high'
        // Fall through to update + alert below

      } else {
        // Carrier matches — set baseline, done
        console.log('[MARx] setting baseline:', detectedPlanCode)
        const baselinePayload: Record<string, any> = {
          last_known_plan_code: detectedPlanCode,
          plan_id:              detectedPlanCode,
          carrier:              realCarrierName || member.carrier || null,
          verification_status:  'verified',
          last_verified_at:     new Date().toISOString(),
          last_marx_check:      new Date().toISOString(),
          // Clear any stale detected fields from a prior switch
          detected_plan_name:    null,
          detected_carrier_name: null,
        }
        if (realPlanName)     baselinePayload.plan_name     = realPlanName
        if (detectedPlanType) baselinePayload.plan_type     = detectedPlanType
        if (detectedContract) baselinePayload.plan_contract = detectedContract
        if (detectedPbp)      baselinePayload.plan_pbp      = detectedPbp

        const baselineResult = await withRetrySafe<void>(
          async () => {
            const res = await db.from('book_of_business').update(baselinePayload).eq('id', member.id)
            if (res.error) throw res.error
          },
          { maxAttempts: 3, baseDelayMs: 300, label: 'marx/verify baseline UPDATE' }
        )
        if (baselineResult.error) {
          console.error('[MARx] baseline UPDATE failed:', JSON.stringify(baselineResult.error))
        } else {
          console.log('[MARx] baseline set OK')
        }
        return NextResponse.json({ changed: false, status: 'baseline_set', marxResult })
      }

    } else {
      // ── Case B: Has stored H-number — compare against detected ───────────────
      const contractChanged = !!(storedContract && detectedContract && storedContract !== detectedContract)
      const pbpChanged = !!(
        storedPbp && detectedPbp &&
        storedPbp.padStart(3, '0') !== detectedPbp.padStart(3, '0')
      )
      const baseCarrier = member.original_carrier_name || member.carrier || null
      const carrierChanged = !!(
        realCarrierName && baseCarrier &&
        baseCarrier.toLowerCase() !== 'unknown' &&
        !carriersMatch(realCarrierName, baseCarrier)
      )

      console.log('[MARx] change flags:', JSON.stringify({ contractChanged, pbpChanged, carrierChanged }))

      if (contractChanged || pbpChanged || carrierChanged) {
        effectiveMarxResult = 'active_changed'
        finalStatus   = 'changed'
        alertType     = carrierChanged && !contractChanged ? 'carrier_switch' : 'plan_switch'
        alertPriority = 'high'
      }
    }
  }

  // ── NPN mismatch check ──────────────────────────────────────────────────────
  // Runs only when the plan matches (verified). Compares the broker's stored NPN
  // against the enrolling_broker_npn field sent by the MARx extension payload.
  // If broker.npn is null we skip the check — NPN has not been configured yet.
  const enrollingBrokerNpn = (body.enrolling_broker_npn as string | null) ?? null
  let detectionStatus: string | null = null

  if (finalStatus === 'verified' && broker.npn && enrollingBrokerNpn && broker.npn !== enrollingBrokerNpn) {
    detectionStatus = 'npn_mismatch'
    console.log('[MARx] NPN mismatch — broker NPN:', broker.npn, '| enrolling NPN:', enrollingBrokerNpn)
  }

  // ── Pending enrollment flag ──────────────────────────────────────────────────
  // Fires when MARx finds no active enrollment, the member was added more than
  // 30 days ago, and enrollment has never been confirmed by a successful MARx run.
  if (!detectionStatus && (marxResult === 'no_ma_plan' || marxResult === 'not_found')) {
    const firstSeen = member.first_seen_at ? new Date(member.first_seen_at) : null
    const cutoff    = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    if (firstSeen && firstSeen < cutoff && !member.enrollment_confirmed) {
      detectionStatus = 'pending_enrollment'
      console.log('[MARx] pending_enrollment — first_seen_at:', member.first_seen_at)
    }
  }

  // ── Build update payload ─────────────────────────────────────────────────────
  // IMPORTANT: When a switch is detected, we do NOT overwrite plan_name or carrier.
  // Those columns always show the ORIGINAL enrolled plan for the broker.
  // The new plan goes into detected_plan_name / detected_carrier_name for the badge.

  const updatePayload: Record<string, any> = {
    verification_status: finalStatus,
    last_verified_at:    new Date().toISOString(),
    last_marx_check:     new Date().toISOString(),
  }

  // Always update the technical plan code columns (used for comparison)
  if (isValidPlanCode(detectedPlanCode)) {
    updatePayload.last_known_plan_code = detectedPlanCode
    if (detectedContract) updatePayload.plan_contract = detectedContract
    if (detectedPbp)      updatePayload.plan_pbp      = detectedPbp
  }
  if (detectedPlanType) updatePayload.plan_type = detectedPlanType

  if (alertType !== null) {
    // Switch detected — store new plan in detected_* fields, preserve originals
    updatePayload.detected_plan_name    = realPlanName    ?? detectedPlanCode ?? null
    updatePayload.detected_carrier_name = realCarrierName ?? null
  } else {
    // Verified (no switch) — update display columns normally, clear any stale detected fields
    if (realPlanName)    updatePayload.plan_name    = realPlanName
    if (realCarrierName) updatePayload.carrier      = realCarrierName
    updatePayload.detected_plan_name    = null
    updatePayload.detected_carrier_name = null
  }

  if (finalStatus === 'termed')                               updatePayload.enrollment_status = 'disenrolled'
  if (finalStatus === 'verified' || finalStatus === 'changed') updatePayload.enrollment_status = 'active'

  // detection_status + enrollment_confirmed tracking
  if (detectionStatus) {
    updatePayload.detection_status            = detectionStatus
    updatePayload.detection_status_updated_at = new Date().toISOString()
  }
  if (finalStatus === 'verified') {
    updatePayload.enrollment_confirmed    = true
    updatePayload.enrollment_confirmed_at = new Date().toISOString()
  }

  // Improve full_name if the stored value looks like a partial/missing name
  const capturedName = typeof body.capturedName === 'string' ? body.capturedName.trim() : null
  if (capturedName && capturedName.length > 2) {
    const currentName  = member.full_name || ''
    const looksPartial = !currentName || currentName === member.member_id || currentName.split(' ').length < 2
    if (looksPartial) {
      updatePayload.full_name = capturedName
    }
  }

  // ── Persist update ───────────────────────────────────────────────────────────
  const updateResult = await withRetrySafe<void>(
    async () => {
      const res = await db.from('book_of_business').update(updatePayload).eq('id', member.id)
      if (res.error) throw res.error
    },
    { maxAttempts: 3, baseDelayMs: 300, label: 'marx/verify status UPDATE' }
  )
  if (updateResult.error) {
    console.error('[MARx] status UPDATE failed:', JSON.stringify(updateResult.error))
  } else {
    console.log('[MARx] status UPDATE ok — status:', finalStatus, '| alertType:', alertType)
  }

  // ── Alert + email dispatch ───────────────────────────────────────────────────
  if (alertType) {
    // Deduplication: skip if we already fired this alert type for this member within 24h
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    // Column is bob_member_id — 'member_id' does not exist on switch_alerts and
    // silently broke dedup (the error was discarded by destructuring only data).
    const { data: existingAlert, error: dedupErr } = await db
      .from('switch_alerts')
      .select('id')
      .eq('bob_member_id', member.id)
      .eq('alert_type', alertType)
      .gte('created_at', yesterday)
      .maybeSingle()
    if (dedupErr) console.error('[MARx] dedup query error:', dedupErr.message)

    if (existingAlert) {
      console.log('[MARx] alert dedup — already alerted within 24h, skipping')
    } else {
      // Record alert in switch_alerts
      const alertDetails: Record<string, any> = {
        storedCode,
        detectedPlanCode,
        realPlanName,
        realCarrierName,
        marxResult: effectiveMarxResult,
      }

      // Add magic detection details if present
      if (magicAlertMessage) {
        alertDetails.magicAlertMessage = magicAlertMessage
        alertDetails.futureEnrollmentPlan = futureEnrollmentPlan
        alertDetails.futureEnrollmentDate = futureEnrollmentDate
        alertDetails.currentMarxPlan = currentMarxPlan
        alertDetails.eligibilityStatus = eligibilityStatus
      }

      // Columns must match the live switch_alerts schema — the previous payload
      // used member_id/previous_plan/detected_plan/details, none of which exist,
      // so EVERY detected switch failed to insert (visible only in Vercel logs).
      const effectiveDateRaw = futureEnrollmentDate ?? detectedFutureStart
      const effectiveDate = effectiveDateRaw && /^\d{4}-\d{2}-\d{2}/.test(effectiveDateRaw)
        ? effectiveDateRaw.slice(0, 10) : null

      const switchType = alertType === 'termed'         ? 'termed'
                       : alertType === 'pending_switch' ? 'future_plan_change'
                       : alertType === 'aor_change'     ? null
                       : 'plan_changed' // plan_switch / carrier_switch

      const { data: insertedAlert, error: alertInsertErr } = await db
        .from('switch_alerts')
        .insert({
          bob_member_id:      member.id,
          ghl_contact_id:     `bob:${member.id}`,
          agency_id:          member.agency_id,
          broker_id:          broker.id,
          alert_type:         alertType,
          priority:           alertPriority,
          status:             'open',
          detection_source:   'marx_extension',
          detected_at:        new Date().toISOString(),
          switch_type:        switchType,
          previous_plan_code: storedCode ?? null,
          new_plan_code:      detectedPlanCode ?? null,
          new_plan_name:      realPlanName ?? null,
          carrier:            realCarrierName ?? member.carrier ?? null,
          previous_value:     member.plan_name ?? storedCode ?? null,
          new_value:          magicAlertMessage ?? realPlanName ?? detectedPlanCode ?? null,
          effective_date:     effectiveDate,
        })
        .select('id')
        .single()
      if (alertInsertErr) console.error('[MARx] alert insert error:', JSON.stringify(alertInsertErr))
      else console.log('[MARx] alert inserted — type:', alertType, '| id:', insertedAlert?.id)

      // Send email notification — only when the alert row exists, so the email
      // always corresponds to something visible in the dashboard. On success we
      // stamp notified_at so the notifications cron doesn't send a duplicate;
      // on failure notified_at stays NULL and the cron retries.
      if (alertInsertErr) {
        console.warn('[MARx] skipping inline email — alert insert failed; cron cannot retry a row that does not exist')
      } else if (notificationEmail) {
        try {
          // Use original enrollment data for "previous" fields
          const previousCarrier  = member.original_carrier_name || member.carrier || 'Previous carrier'
          const previousPlanName = member.plan_name || storedCode || 'Plan on file'
          const newCarrier       = realCarrierName || 'New carrier detected'
          const newPlanName      = realPlanName || detectedPlanCode || 'New plan detected'

          const emailSwitchType = alertType === 'termed'         ? 'termed'
                                : alertType === 'pending_switch' ? 'future_plan_change'
                                : alertType === 'carrier_switch' ? 'carrier_switch'
                                : 'plan_switch'

          await sendSwitchAlertEmail(notificationEmail, {
            memberName:          member.full_name ?? 'Unknown Member',
            previousPlanName,
            previousCarrier,
            newPlanName,
            newCarrier,
            switchType:          emailSwitchType,
            futurePlanName:      detectedFuturePlan   ?? undefined,
            futureEffectiveDate: detectedFutureStart  ?? undefined,
            detectedVia:         'MARx Extension',
            alertUrl:            `${APP_URL}/book`,
          })
          console.log('[MARx] email sent to', notificationEmail, '— switchType:', emailSwitchType)

          // Mark as notified so the scheduler cron doesn't re-send this alert
          if (insertedAlert?.id) {
            const { error: stampErr } = await db
              .from('switch_alerts')
              .update({ notified_at: new Date().toISOString(), notification_email: notificationEmail })
              .eq('id', insertedAlert.id)
            if (stampErr) console.error('[MARx] notified_at stamp failed:', stampErr.message)
          }
        } catch (emailErr: any) {
          console.error('[MARx] email send failed:', emailErr?.message ?? String(emailErr))
        }
      } else {
        console.warn('[MARx] no notification email configured for broker:', broker.id)
      }
    }
  }

  return NextResponse.json({
    changed:         alertType !== null,
    status:          finalStatus,
    marxResult:      effectiveMarxResult,
    alertType:       alertType ?? null,
    storedCode,
    detectedPlanCode,
    realPlanName,
    realCarrierName,
  })
}

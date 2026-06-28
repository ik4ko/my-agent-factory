import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { hashName } from '@/lib/churn/roster-parser'
import { notifyNewSwitchAlerts } from '@/lib/email/send-notifications'
import { SyncBaselineEngine } from '@/lib/detection/sync-baseline-engine'
import { ConfidenceScoringEngine } from '@/lib/detection/confidence-scoring-engine'
import { IngestionCacheEngine } from '@/lib/detection/ingestion-cache-engine'
import { AlertRoutingEngine } from '@/lib/detection/alert-routing-engine'
import type { RosterRow } from '@/lib/churn/roster-parser'

type ExtendedRosterRow = RosterRow & { term_date?: string; disenroll_reason?: string }

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const CARRIER_DISPLAY: Record<string, string> = {
  humana: 'Humana', uhc: 'UHC', clover: 'Clover',
  aetna: 'Aetna', bcbs: 'BCBS', wellcare: 'Wellcare', cigna: 'Cigna',
  devoted: 'Devoted Health', healthfirst: 'Health First NY',
}

const CARRIER_PORTAL_URL: Record<string, string> = {
  humana: 'https://agentportal.humana.com/Vantage/MyBusiness',
  clover: 'https://clover.evolvenxt.com/portal/member_search.htm',
  devoted: 'https://agent.devoted.com/book_of_business_contacts',
  healthfirst: 'https://myhfgroup.org/spa/medicare/#/my-members',
}

function getCarrierPortalUrl(c: string): string | null {
  return CARRIER_PORTAL_URL[c.toLowerCase()] ?? null
}

function getCarrierDisplayName(c: string): string {
  return CARRIER_DISPLAY[c.toLowerCase()] ?? c
}

function generateMemberId(name: string, carrier: string, raw?: Record<string, string>): string {
  const normalized = (name ?? '').toLowerCase().trim().replace(/\s+/g, '_')
  if (normalized) return `${carrier}_${normalized}`
  // Stable djb2 hash of all row values so the same member gets the same ID across syncs
  if (raw) {
    const payload = Object.values(raw).sort().join('|')
    let h = 5381
    for (let i = 0; i < payload.length; i++) {
      h = ((h << 5) + h) ^ payload.charCodeAt(i)
      h >>>= 0
    }
    return `${carrier}_${h.toString(36)}`
  }
  return `${carrier}_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

// POST /api/extension/sync
// Body: { carrier: string, rows: Record<string, string>[] }
// Authorization: Bearer <extension_api_key>
export async function POST(req: NextRequest) {
  const broker = await getBrokerFromApiKey(req)
  if (!broker) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body?.carrier || !Array.isArray(body?.rows)) {
    return NextResponse.json({ error: 'Missing carrier or rows' }, { status: 400 })
  }

  const carrier = (body.carrier as string).toLowerCase().trim()
  const rawRows: Record<string, string>[] = body.rows
  // PHI-SAFE: only log non-PHI metadata — never log row contents, member names, or MBIs
  if (rawRows.length > 0) {
    console.log('[sync] carrier:', carrier, '| row_count:', rawRows.length, '| col_count:', Object.keys(rawRows[0]).length)
  }
  if (rawRows.length === 0) return NextResponse.json({ error: 'No rows received' }, { status: 400 })

  const supabaseAdmin = createServiceClient()
  const agencyId = broker.agency_id
  const brokerId = broker.id
  if (!agencyId) return NextResponse.json({ error: 'No agency found' }, { status: 400 })

  // ── Baseline Engine: create sync record BEFORE processing ─────────────────
  const baselineEngine = new SyncBaselineEngine()
  const syncRecord = await baselineEngine.createSyncResult({
    agencyId,
    brokerId,
    carrier,
    syncType: 'manual',
  })

  // ── Step 1: Normalize incoming rows ────────────────────────────────────────
  let mapping: Record<string, string> = {}
  if (rawRows.length > 0) {
    const headers = Object.keys(rawRows[0])
    const ingestionEngine = new IngestionCacheEngine()
    const result = await ingestionEngine.mapHeaders(headers, carrier)
    mapping = result.mapping
    console.log(`[sync] IngestionCacheEngine usedCache: ${result.usedCache}`)
  }

  const newRoster = rawRows.map(r => normalizeRow(r, carrier, mapping)) as ExtendedRosterRow[]

  // ── Baseline Engine: evaluate health + gate delta engine ──────────────────
  const evaluation = await baselineEngine.evaluateSyncResult(syncRecord.id, newRoster.length)

  const crossCarrier = await baselineEngine.checkCrossCarrierDegradation(agencyId)
  if (crossCarrier.multiCarrierDegraded) {
    await supabaseAdmin
      .from('sync_results')
      .update({ multi_carrier_degraded: true })
      .eq('id', syncRecord.id)
  }

  if (!evaluation.deltaEngineAllowed) {
    return NextResponse.json({
      success: true,
      status: evaluation.status,
      total: newRoster.length,
      deltaEngineSkipped: true,
      reason: evaluation.status,
      message: evaluation.message ?? 'Sync health check failed — delta engine paused',
      ...(evaluation.retryScheduledAt ? { retry_at: evaluation.retryScheduledAt } : {}),
      ...(crossCarrier.multiCarrierDegraded ? { multi_carrier_degraded: true, affected_carriers: crossCarrier.affectedCarriers } : {}),
    })
  }

  // ── Step 2: Fetch previous book_of_business for diff ──────────────────────
  const { data: prevBook } = await supabaseAdmin
    .from('book_of_business')
    .select('id, member_id, full_name, plan_name, verification_status')
    .eq('broker_id', brokerId)
    .eq('carrier', carrier)

  const prevMembers = prevBook ?? []

  // ── Step 3: Compute diff ───────────────────────────────────────────────────
  const newMemberIds = new Set(
    newRoster.map(r => r.member_id ?? generateMemberId(r.full_name, carrier, r.raw as Record<string, string>))
  )
  const prevMemberIds = new Set(prevMembers.map(m => m.member_id).filter(Boolean) as string[])

  const missing = prevMembers.filter(m => m.member_id && !newMemberIds.has(m.member_id))
  const newlyEnrolled = newRoster.filter(r => {
    const id = r.member_id ?? generateMemberId(r.full_name, carrier, r.raw as Record<string, string>)
    return !prevMemberIds.has(id)
  })
  
  const reappeared = prevMembers.filter(m => m.verification_status === 'missing' && m.member_id && newMemberIds.has(m.member_id))

  // ── Step 4: Create roster_upload record (audit trail) ─────────────────────
  const { data: uploadRecord, error: uploadErr } = await supabaseAdmin
    .from('roster_uploads')
    .insert({
      agency_id: agencyId,
      broker_id: brokerId,
      uploaded_by: broker.user_id,
      carrier,
      file_path: `extension/${agencyId}/${Date.now()}_${carrier}`,
      row_count: newRoster.length,
      status: 'processing',
      source: 'extension',
    })
    .select('id')
    .single()

  if (uploadErr || !uploadRecord) {
    return NextResponse.json({ error: `DB error: ${uploadErr?.message}` }, { status: 500 })
  }

  const uploadId = uploadRecord.id

  // ── Step 5: Upsert roster_members (audit trail) ────────────────────────────
  const memberRecords = newRoster.map(r => ({
    upload_id: uploadId,
    agency_id: agencyId,
    carrier,
    member_id: r.member_id ?? null,
    full_name: r.full_name || null,
    name_hash: hashName(r.full_name, r.dob),
    dob_hash: r.dob ? hashName(r.dob) : null,
    effective_date: r.effective_date ? parseDate(r.effective_date) : null,
    plan_name: r.plan_name ?? null,
    status: r.status ?? null,
    raw_row: r.raw ?? null,
  }))

  for (let i = 0; i < memberRecords.length; i += 500) {
    const { error } = await supabaseAdmin.from('roster_members').insert(memberRecords.slice(i, i + 500))
    if (error) console.error('[extension/sync] roster_members insert error:', error.message)
  }

  // ── Step 6: Upsert to book_of_business (source of truth) ──────────────────
  const bobUpserts = newRoster.map(r => ({
    agency_id: agencyId,
    broker_id: brokerId,
    synced_by: broker.user_id,
    carrier,
    carrier_display_name: getCarrierDisplayName(carrier),
    member_id: r.member_id ?? generateMemberId(r.full_name, carrier, r.raw as Record<string, string>),
    full_name: r.full_name || null,
    plan_name: r.plan_name ?? null,
    plan_id: r.plan_id ?? null,
    effective_date: r.effective_date ? parseDate(r.effective_date) : null,
    status: normalizeStatus(r.status ?? ''),
    verification_status: 'verified',
    last_verified_at: new Date().toISOString(),
    term_date: r.term_date ? parseDate(r.term_date) : null,
    disenroll_reason: r.disenroll_reason ?? null,
  }))

  for (let i = 0; i < bobUpserts.length; i += 500) {
    const { error } = await supabaseAdmin
      .from('book_of_business')
      .upsert(bobUpserts.slice(i, i + 500), { onConflict: 'broker_id,carrier,member_id', ignoreDuplicates: false })
    if (error) console.error('[extension/sync] book_of_business upsert error:', error.message)
  }

  // ── Step 7: Mark missing members + create switch alerts ───────────────────
  let alertCount = 0

  if (missing.length > 0) {
    const scoring = new ConfidenceScoringEngine()
    const missingIds = missing.map(m => m.id)

    await supabaseAdmin
      .from('book_of_business')
      .update({ verification_status: 'missing', last_missing_at: new Date().toISOString() })
      .in('id', missingIds)

    for (const m of missing) {
      const isConsecutive = m.verification_status === 'missing'
      const eventType = isConsecutive ? 'CONSECUTIVE_MISSING' : 'INITIAL_SCRAPE_MISSING'
      
      const result = await scoring.computeConfidence({
        bobMemberId: m.id,
        carrier,
        brokerId,
        agencyId,
        detectionEvent: eventType,
        syncId: syncRecord.id
      })
      
      if (result.shouldAlert && result.isNewAlert) {
        const { data: alert, error } = await supabaseAdmin.from('switch_alerts').insert({
          agency_id: agencyId,
          broker_id: brokerId,
          bob_member_id: m.id,
          ghl_contact_id: `bob:${m.id}`,
          upload_id: uploadId,
          alert_type: 'missing_from_roster',
          previous_value: m.plan_name ?? null,
          new_value: null,
          carrier,
          priority: 'critical',
          status: 'open',
          detection_source: 'extension_sync',
          detected_at: new Date().toISOString(),
          confidence_score: result.C,
          confidence_status: result.status
        }).select('id').single()
        
        if (!error && alert) {
          alertCount++
          await supabaseAdmin
            .from('member_detection_log')
            .update({ switch_alert_id: alert.id })
            .eq('bob_member_id', m.id)
            .eq('carrier', carrier)

          const { data: agency } = await supabaseAdmin.from('agencies').select('billing_plan').eq('id', agencyId).maybeSingle()
          const tier = (agency?.billing_plan && agency.billing_plan.includes('agency') ? 'agency' : 'solo')
          
          const routingEngine = new AlertRoutingEngine()
          await routingEngine.routeAlert({
            alertId: alert.id,
            agencyId,
            brokerId,
            tier
          })
        } else if (error) {
          console.error('[extension/sync] alert insert error:', error.message)
        }
      } else if (result.shouldAlert && !result.isNewAlert) {
        await supabaseAdmin
          .from('switch_alerts')
          .update({ confidence_score: result.C, confidence_status: result.status })
          .eq('bob_member_id', m.id)
          .eq('carrier', carrier)
          .eq('status', 'open')
      }
    }
  }

  if (reappeared.length > 0) {
    const scoring = new ConfidenceScoringEngine()
    for (const m of reappeared) {
      const decayResult = await scoring.applyConfidenceDecay({
        bobMemberId: m.id,
        carrier,
        brokerId,
        agencyId
      })
      
      if (decayResult.notifyBroker) {
        // PHI-SAFE: log member UUID only — never log full_name or MBI
        console.log(`[sync] member re-appeared on ${carrier} roster — bob_id: ${m.id}`)
      }
    }
  }

  // ── Step 8: Mark upload complete ──────────────────────────────────────────
  await supabaseAdmin
    .from('roster_uploads')
    .update({
      status: 'complete',
      processed_at: new Date().toISOString(),
      matched_count: newRoster.length - missing.length,
      missing_count: missing.length,
      new_count: newlyEnrolled.length,
    })
    .eq('id', uploadId)

  if (alertCount > 0) {
    notifyNewSwitchAlerts(uploadId, agencyId).catch(err =>
      console.error('[extension/sync] notification error:', err)
    )
  }

  // ── Step 9: Mark baseline sync complete ───────────────────────────────────
  await supabaseAdmin
    .from('sync_results')
    .update({ delta_engine_ran: true, completed_at: new Date().toISOString() })
    .eq('id', syncRecord.id)

  return NextResponse.json({
    success: true,
    status: evaluation.status,
    total: newRoster.length,
    previous: prevMembers.length,
    missing: missing.length,
    new_members: newlyEnrolled.length,
    alerts_created: alertCount,
    changes_detected: missing.length > 0,
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getBrokerFromApiKey(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization') ?? ''
  const token = authHeader.replace('Bearer ', '').trim()
  if (token.length < 32) {
    console.warn('[extension/sync] API key too short or missing')
    return null
  }
  const supabase = createServiceClient()
  const { data: broker, error } = await supabase
    .from('brokers')
    .select('id, agency_id, user_id')
    .eq('extension_api_key', token)
    .maybeSingle()
  if (error) console.error('[extension/sync] broker lookup error:', error.message)
  if (!broker) console.warn('[extension/sync] no broker found for provided api key')
  return broker ?? null
}

function normalizeRow(raw: Record<string, string>, _carrier: string, dynamicMapping?: Record<string, string>): ExtendedRosterRow {
  // Build a normalized lookup map: lowercase + spaces/underscores collapsed.
  // This lets get('member name') find raw['Member Name'] or raw['member_name'].
  const norm: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    norm[k.toLowerCase().replace(/[\s_]+/g, ' ').trim()] = v
    norm[k.toLowerCase().replace(/[\s_]+/g, '_').trim()] = v
    
    // Apply dynamic mapping fallback if provided
    if (dynamicMapping && dynamicMapping[k]) {
      const targetCol = dynamicMapping[k]
      if (!norm[targetCol]) norm[targetCol] = v
    }
  }

  const get = (...keys: string[]) => {
    for (const k of keys) {
      const v = raw[k]
        ?? raw[k.toLowerCase()]
        ?? raw[k.replace(/ /g, '_')]
        ?? norm[k.toLowerCase().replace(/[\s_]+/g, ' ').trim()]
        ?? norm[k.toLowerCase().replace(/[\s_]+/g, '_').trim()]
      if (v?.trim()) return v.trim()
    }
    return undefined
  }

  // Try combined name first, then assemble from split first/last columns
  const combinedName = get(
    'Member Name', 'member name', 'MEMBER NAME',
    'Subscriber Name', 'subscriber name', 'SUBSCRIBER NAME', 'subscriber_name',
    'Insured Name', 'insured name',
    'Patient Name', 'Patient', 'patient',
    'Name', 'name',
    'Beneficiary Name',
    'Full Name', 'full name', 'FULL NAME', 'full_name', 'fullname',
    'Contact Name', 'contact name',
    'Enrollee Name', 'enrollee name', 'Enrollee', 'enrollee',
    'client name', 'member_name',
    'col_0', 'col_1', 'col_2'
  )
  const firstName = get('Member First Name', 'member first name', 'MEMBER FIRST NAME', 'First Name', 'first name', 'FIRST NAME', 'First', 'first', 'fname', 'first_name')
  const lastName  = get('Member Last Name', 'member last name', 'MEMBER LAST NAME', 'Last Name', 'last name', 'LAST NAME', 'Last', 'last', 'lname', 'last_name')
  const assembledName = (firstName || lastName)
    ? [firstName, lastName].filter(Boolean).join(' ')
    : undefined
  const full_name = combinedName || assembledName || ''

  return {
    full_name,
    member_id: get(
      'Member ID', 'member id', 'MEMBER ID',
      'MemberID', 'member_id', 'ID', 'id',
      'Policy Number', 'policy number', 'Policy #',
      'Contract Number', 'member number', 'subscriber id',
      'memberId', 'col_1'
    ),
    plan_name: get(
      'Plan Name', 'plan name', 'PLAN NAME',
      'Plan', 'plan', 'Product', 'Product Name', 'product',
      'Plan Type', 'plan type', 'Coverage', 'coverage',
      'plan_name', 'col_2'
    ),
    effective_date: get('effective date', 'Effective Date', 'eff date', 'start date', 'effective_date', 'col_3'),
    status: get('status', 'Status', 'policy status', 'Policy Status', 'enrollment status', 'Enrollment Status', 'Member Status', 'member status', 'col_4'),
    dob: get('date of birth', 'Date of Birth', 'dob', 'DOB', 'birth date', 'date_of_birth'),
    term_date: get('Term Date', 'term date', 'TERM DATE', 'Termination Date', 'termination date', 'term_date', 'Disenroll Date', 'disenroll date'),
    disenroll_reason: get('Disenrollment Reason', 'disenrollment reason', 'Disenroll Reason', 'disenroll_reason', 'Termination Reason', 'termination reason'),
    raw,
  }
}

function parseDate(s: string): string | null {
  if (!s) return null
  const d = new Date(s)
  if (isNaN(d.getTime())) return null
  return d.toISOString().split('T')[0]
}

function normalizeStatus(raw: string): string {
  const s = (raw ?? '').toLowerCase().trim()
  if (s.includes('term') || s.includes('inact') ||
      s.includes('cancel') || s.includes('disenroll') ||
      s.includes('void') || s.includes('closed')) return 'termed'
  if (s === 'enrolled' || s.includes('enroll')) return 'active'
  if (s.includes('pend')) return 'pending'
  if (s.includes('future')) return 'future'
  return 'active'
}

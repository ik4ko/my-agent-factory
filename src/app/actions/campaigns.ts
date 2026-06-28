'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { addGHLTag, createGHLTask, triggerGHLWorkflow } from '@/lib/campaigns/ghl-workflow'

// --- Seed default campaign templates once ------------------------------------

const DEFAULT_TEMPLATES = [
  {
    id: 'aep_shield',
    name: 'AEP Shield',
    description: 'Annual Enrollment Period protection sequence',
    campaign_type: 'aep_shield',
    trigger_type: 'aep_proximity',
    trigger_days_before: 90,
    ghl_workflow_id: null,
    ghl_workflow_name: null,
    steps: [
      { day: 0,  type: 'sms',  message: 'Hi {first_name}, AEP starts Oct 15. Your current plan is being reviewed. Reply STOP to opt out.' },
      { day: 7,  type: 'sms',  message: 'AEP reminder: Want to review your Medicare plan options? Reply YES and your broker will call.' },
      { day: 14, type: 'task', title: 'Call client -- AEP review due' },
      { day: 30, type: 'sms',  message: 'AEP ends Dec 7. Last chance to review your 2027 Medicare plan. Call us today.' },
    ],
    active: true,
  },
  {
    id: 'reactive_save',
    name: 'Reactive Save',
    description: 'Emergency campaign when switch detected',
    campaign_type: 'reactive_save',
    trigger_type: 'switch_alert',
    trigger_days_before: null,
    ghl_workflow_id: null,
    ghl_workflow_name: null,
    steps: [
      { day: 0, type: 'task', title: 'URGENT: Call client -- possible plan switch detected', priority: 'critical' },
      { day: 0, type: 'sms',  message: 'Hi {first_name}, this is {broker_name}. I want to make sure your Medicare coverage is still active. Can we talk today?' },
      { day: 2, type: 'task', title: 'Follow up call -- switch alert unresolved' },
      { day: 5, type: 'sms',  message: 'Just checking in {first_name}. Your benefits are important -- please call {broker_phone} when you can.' },
    ],
    active: true,
  },
  {
    id: 'VCC_followup',
    name: 'VCC Doctor Follow-up',
    description: 'Chase sequence for unsigned VCC Forms',
    campaign_type: 'VCC_followup',
    trigger_type: 'VCC_unsigned',
    trigger_days_before: null,
    ghl_workflow_id: null,
    ghl_workflow_name: null,
    steps: [
      { day: 0,  type: 'sms',  message: 'Hi {first_name}, we sent a form to your doctor for your extra benefits. Please remind them to sign it.' },
      { day: 10, type: 'task', title: 'Check if doctor signed VCC Form' },
      { day: 10, type: 'sms',  message: "Reminder: Your extra grocery/OTC benefits are waiting! Has your doctor signed the form we sent?" },
      { day: 20, type: 'task', title: 'URGENT: VCC deadline approaching -- escalate' },
      { day: 45, type: 'sms',  message: 'Important: Only 15 days left to get your VCC benefits approved. Please contact your doctor ASAP.' },
    ],
    active: true,
  },
  {
    id: 'renewal_reminder',
    name: 'Annual Renewal Reminder',
    description: 'Proactive renewal outreach sequence',
    campaign_type: 'renewal_reminder',
    trigger_type: 'enrollment_anniversary',
    trigger_days_before: 60,
    ghl_workflow_id: null,
    ghl_workflow_name: null,
    steps: [
      { day: 0,  type: 'sms',  message: 'Hi {first_name}, your Medicare plan renews soon. Your broker {broker_name} will review your options.' },
      { day: 14, type: 'task', title: 'Schedule annual review call with client' },
      { day: 30, type: 'sms',  message: 'Plan review reminder for {first_name} -- call scheduled? Reply YES if connected.' },
    ],
    active: true,
  },
]

async function ensureTemplatesSeeded() {
  const supabase = createServiceClient()
  const { count } = await supabase.from('campaign_templates').select('id', { count: 'exact', head: true })
  if ((count ?? 0) > 0) return
  await supabase.from('campaign_templates').insert(DEFAULT_TEMPLATES)
}

// --- Helpers -----------------------------------------------------------------

async function resolveAgencyId(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<string | null> {
  const { data: agencyRow } = await supabase.from('agencies').select('id').eq('owner_id', userId).maybeSingle()
  if (agencyRow) return agencyRow.id
  const { data: brokerRow } = await supabase.from('brokers').select('agency_id').eq('user_id', userId).maybeSingle()
  return brokerRow?.agency_id ?? null
}

async function resolveBrokerId(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<string | null> {
  const { data } = await supabase.from('brokers').select('id').eq('user_id', userId).maybeSingle()
  return data?.id ?? null
}

function todayPlusDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

// --- Actions -----------------------------------------------------------------

export async function triggerReactiveSave(alertId: string): Promise<{ success: boolean; taskId?: string; error?: string }> {
  await ensureTemplatesSeeded()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const agencyId = await resolveAgencyId(supabase, user.id)
  const brokerId = await resolveBrokerId(supabase, user.id)
  if (!agencyId) return { success: false, error: 'No agency' }

  const { data: alert } = await supabase
    .from('switch_alerts')
    .select('ghl_contact_id, carrier, alert_type')
    .eq('id', alertId)
    .maybeSingle()

  if (!alert) return { success: false, error: 'Alert not found' }

  const supabaseAdmin = createServiceClient()

  // Tag + task in GHL (best-effort -- non-fatal if credentials missing)
  const [tagResult, taskResult] = await Promise.all([
    addGHLTag(agencyId, alert.ghl_contact_id, ['SWITCH-ALERT', 'REACTIVE-SAVE']),
    createGHLTask(agencyId, alert.ghl_contact_id, {
      title: 'URGENT: Client may have switched plans -- call today',
      dueDate: todayPlusDays(0),
    }),
  ])

  // Enroll in campaign
  const { data: enrollment } = await supabaseAdmin
    .from('campaign_enrollments')
    .insert({
      agency_id: agencyId,
      ghl_contact_id: alert.ghl_contact_id,
      broker_id: brokerId,
      template_id: 'reactive_save',
      triggered_by: 'switch_alert',
      trigger_resource_id: alertId,
      status: 'active',
      metadata: { carrier: alert.carrier, alert_type: alert.alert_type },
    })
    .select('id')
    .single()

  // Mark alert as workflow-triggered
  await supabaseAdmin
    .from('switch_alerts')
    .update({ ghl_workflow_triggered: true, status: 'contacted' })
    .eq('id', alertId)

  // Audit log (best-effort — ignore errors so campaign still succeeds)
  try {
    await supabaseAdmin
      .from('audit_log')
      .insert({
        agency_id: agencyId,
        actor_id: user.id,
        action: 'CAMPAIGN_TRIGGERED',
        resource_type: 'switch_alert',
        resource_id: alertId,
        metadata: { template_id: 'reactive_save', enrollment_id: enrollment?.id },
      })
  } catch {}

  return { success: true, taskId: taskResult.taskId }
}

export async function triggerVCCFollowup(submissionId: string): Promise<{ success: boolean; error?: string }> {
  await ensureTemplatesSeeded()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const agencyId = await resolveAgencyId(supabase, user.id)
  const brokerId = await resolveBrokerId(supabase, user.id)
  if (!agencyId) return { success: false, error: 'No agency' }

  const { data: sub } = await supabase
    .from('vcc_submissions')
    .select('ghl_contact_id, client_name, doctor_name')
    .eq('id', submissionId)
    .maybeSingle()

  if (!sub) return { success: false, error: 'Submission not found' }

  const supabaseAdmin = createServiceClient()

  await Promise.all([
    addGHLTag(agencyId, sub.ghl_contact_id, ['VCC-PENDING']),
    createGHLTask(agencyId, sub.ghl_contact_id, {
      title: `Follow up: Has doctor signed VCC Form for ${sub.client_name}?`,
      dueDate: todayPlusDays(10),
    }),
  ])

  await supabaseAdmin
    .from('campaign_enrollments')
    .insert({
      agency_id: agencyId,
      ghl_contact_id: sub.ghl_contact_id,
      broker_id: brokerId,
      template_id: 'VCC_followup',
      triggered_by: 'VCC_deadline',
      trigger_resource_id: submissionId,
      status: 'active',
      metadata: { client_name: sub.client_name },
    })

  return { success: true }
}

export async function enrollInAEPShield(
  ghlContactId: string,
  enrollmentAnniversary?: string
): Promise<{ success: boolean; scheduleId?: string; error?: string }> {
  await ensureTemplatesSeeded()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const agencyId = await resolveAgencyId(supabase, user.id)
  const brokerId = await resolveBrokerId(supabase, user.id)
  if (!agencyId) return { success: false, error: 'No agency' }

  const supabaseAdmin = createServiceClient()

  // Enroll in campaign first
  const { data: enrollment } = await supabaseAdmin
    .from('campaign_enrollments')
    .insert({
      agency_id: agencyId,
      ghl_contact_id: ghlContactId,
      broker_id: brokerId,
      template_id: 'aep_shield',
      triggered_by: 'manual',
      status: 'active',
    })
    .select('id')
    .single()

  // Upsert AEP schedule
  const { data: schedule, error } = await supabaseAdmin
    .from('aep_schedule')
    .upsert(
      {
        agency_id: agencyId,
        ghl_contact_id: ghlContactId,
        broker_id: brokerId,
        enrollment_anniversary: enrollmentAnniversary ?? null,
        campaign_enrollment_id: enrollment?.id ?? null,
      },
      { onConflict: 'agency_id,ghl_contact_id' }
    )
    .select('id')
    .single()

  if (error) return { success: false, error: error.message }

  await addGHLTag(agencyId, ghlContactId, ['AEP-SHIELD-ACTIVE'])

  return { success: true, scheduleId: schedule?.id }
}

export async function cancelCampaignEnrollment(enrollmentId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { error } = await supabase
    .from('campaign_enrollments')
    .update({ status: 'cancelled', completed_at: new Date().toISOString() })
    .eq('id', enrollmentId)

  if (error) return { success: false, error: error.message }
  return { success: true }
}

export async function getContactCampaigns(ghlContactId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('campaign_enrollments')
    .select('*, template:template_id (name, campaign_type)')
    .eq('ghl_contact_id', ghlContactId)
    .order('enrolled_at', { ascending: false })

  return data ?? []
}

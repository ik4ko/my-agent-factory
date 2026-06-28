import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { Resend } from 'resend'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuditLogRecord {
  id: string
  user_id: string | null
  agency_id: string | null
  action_type: string
  resource_type: string | null
  resource_id: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

interface SupabaseWebhookPayload {
  type: 'INSERT'
  table: string
  record: AuditLogRecord
  schema: string
  old_record: null
}

interface AlertPayload {
  alert_type: 'HIGH_FREQUENCY_ACCESS' | 'OFF_HOURS_ACCESS' | 'CROSS_AGENCY_ACCESS'
  user_id: string | null
  agency_id: string | null
  resource_id: string | null
  timestamp: string
  details: string
}

// ── Constants ───────────────────────────────────────────────────────────────────

const WEBHOOK_SECRET = process.env.SUPABASE_WEBHOOK_SECRET
const SLACK_WEBHOOK_URL = process.env.SLACK_AUDIT_WEBHOOK_URL
const SECURITY_ALERT_EMAIL = process.env.SECURITY_ALERT_EMAIL
const RESEND_API_KEY = process.env.RESEND_API_KEY

const HIGH_FREQUENCY_THRESHOLD = 10
const HIGH_FREQUENCY_WINDOW_MINUTES = 60

const EASTERN_START_HOUR = 7
const EASTERN_END_HOUR = 20

// ── Helper Functions ───────────────────────────────────────────────────────────

/**
 * Convert UTC timestamp to US/Eastern hour (0-23)
 */
function getEasternHour(utcTimestamp: string): number {
  const utcDate = new Date(utcTimestamp)
  const easternOffset = -5 // UTC-5 for Eastern Standard Time
  // Note: This is simplified - production should use timezone-aware library like date-fns-tz
  const easternDate = new Date(utcDate.getTime() + easternOffset * 60 * 60 * 1000)
  return easternDate.getHours()
}

/**
 * Check if timestamp is within business hours (07:00–20:00 US/Eastern)
 */
function isBusinessHours(utcTimestamp: string): boolean {
  const easternHour = getEasternHour(utcTimestamp)
  return easternHour >= EASTERN_START_HOUR && easternHour < EASTERN_END_HOUR
}

/**
 * Send alert to Slack webhook
 */
async function sendSlackAlert(payload: AlertPayload): Promise<void> {
  if (!SLACK_WEBHOOK_URL) {
    console.warn('[audit/alert-receiver] SLACK_AUDIT_WEBHOOK_URL not set, skipping Slack notification')
    return
  }

  try {
    const slackMessage = {
      text: `🚨 Security Alert: ${payload.alert_type}`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `🚨 Security Alert: ${payload.alert_type}`,
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Alert Type:*\n${payload.alert_type}`,
            },
            {
              type: 'mrkdwn',
              text: `*User ID:*\n${payload.user_id || 'N/A'}`,
            },
            {
              type: 'mrkdwn',
              text: `*Agency ID:*\n${payload.agency_id || 'N/A'}`,
            },
            {
              type: 'mrkdwn',
              text: `*Resource ID:*\n${payload.resource_id || 'N/A'}`,
            },
            {
              type: 'mrkdwn',
              text: `*Timestamp:*\n${payload.timestamp}`,
            },
            {
              type: 'mrkdwn',
              text: `*Details:*\n${payload.details}`,
            },
          ],
        },
      ],
    }

    await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slackMessage),
    })
  } catch (error) {
    console.error('[audit/alert-receiver] Slack notification failed:', error)
  }
}

/**
 * Send alert email via Resend
 */
async function sendEmailAlert(payload: AlertPayload): Promise<void> {
  if (!RESEND_API_KEY || !SECURITY_ALERT_EMAIL) {
    console.warn('[audit/alert-receiver] RESEND_API_KEY or SECURITY_ALERT_EMAIL not set, skipping email notification')
    return
  }

  try {
    const resend = new Resend(RESEND_API_KEY)

    await resend.emails.send({
      from: 'AegisSage Security <security@aegissage.com>',
      to: SECURITY_ALERT_EMAIL,
      subject: `🚨 Security Alert: ${payload.alert_type}`,
      html: `
        <h2>🚨 Security Alert: ${payload.alert_type}</h2>
        <table style="border-collapse: collapse; width: 100%; margin-top: 20px;">
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Alert Type:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${payload.alert_type}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>User ID:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${payload.user_id || 'N/A'}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Agency ID:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${payload.agency_id || 'N/A'}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Resource ID:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${payload.resource_id || 'N/A'}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Timestamp:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${payload.timestamp}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Details:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${payload.details}</td>
          </tr>
        </table>
      `,
    })
  } catch (error) {
    console.error('[audit/alert-receiver] Email notification failed:', error)
  }
}

/**
 * Log security alert to audit_log
 */
async function logSecurityAlert(
  admin: ReturnType<typeof createServiceClient>,
  payload: AlertPayload
): Promise<void> {
  try {
    await admin.from('audit_log').insert({
      agency_id: payload.agency_id,
      user_id: payload.user_id,
      action: 'SECURITY_ALERT_FIRED',
      resource_type: 'audit_log',
      resource_id: payload.resource_id,
      metadata: {
        alert_type: payload.alert_type,
        details: payload.details,
        timestamp: payload.timestamp,
      },
      created_at: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[audit/alert-receiver] Failed to log security alert:', error)
  }
}

/**
 * Check for high-frequency access (>10 PHI_ACCESS events in 60-minute window)
 */
async function checkHighFrequencyAccess(
  admin: ReturnType<typeof createServiceClient>,
  record: AuditLogRecord
): Promise<boolean> {
  if (!record.user_id || record.action_type !== 'PHI_ACCESS') {
    return false
  }

  const sixtyMinutesAgo = new Date(Date.now() - HIGH_FREQUENCY_WINDOW_MINUTES * 60 * 1000).toISOString()

  const { data, error } = await admin
    .from('audit_log')
    .select('id')
    .eq('user_id', record.user_id)
    .eq('action_type', 'PHI_ACCESS')
    .gte('created_at', sixtyMinutesAgo)

  if (error) {
    console.error('[audit/alert-receiver] High-frequency check failed:', error)
    return false
  }

  const count = data?.length ?? 0
  return count > HIGH_FREQUENCY_THRESHOLD
}

/**
 * Check for off-hours access (outside 07:00–20:00 US/Eastern)
 */
function checkOffHoursAccess(record: AuditLogRecord): boolean {
  if (record.action_type !== 'PHI_ACCESS') {
    return false
  }
  return !isBusinessHours(record.created_at)
}

/**
 * Check for cross-agency access (resource doesn't belong to user's agency)
 */
async function checkCrossAgencyAccess(
  admin: ReturnType<typeof createServiceClient>,
  record: AuditLogRecord
): Promise<boolean> {
  if (!record.agency_id || !record.resource_id || record.action_type !== 'PHI_ACCESS') {
    return false
  }

  // Check if the resource belongs to the user's agency
  const { data, error } = await admin
    .from('book_of_business')
    .select('agency_id')
    .eq('id', record.resource_id)
    .maybeSingle()

  if (error) {
    console.error('[audit/alert-receiver] Cross-agency check failed:', error)
    return false
  }

  if (!data) {
    // Resource not found - could be deleted or invalid
    return false
  }

  return data.agency_id !== record.agency_id
}

// ── Main Handler ───────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── Verify webhook secret ───────────────────────────────────────────────────
  const webhookSecret = req.headers.get('x-supabase-webhook-secret')
  if (webhookSecret !== WEBHOOK_SECRET) {
    console.error('[audit/alert-receiver] Invalid webhook secret')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Parse webhook payload ───────────────────────────────────────────────────
  let body: SupabaseWebhookPayload
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Only process INSERT events on audit_log table
  if (body.type !== 'INSERT' || body.table !== 'audit_log') {
    return NextResponse.json({ success: true, message: 'Ignoring non-INSERT event' })
  }

  const record = body.record

  // Only process PHI_ACCESS events
  if (record.action_type !== 'PHI_ACCESS') {
    return NextResponse.json({ success: true, message: 'Ignoring non-PHI_ACCESS event' })
  }

  // ── Initialize service client ───────────────────────────────────────────────
  const admin = createServiceClient()

  // ── Run detection checks ───────────────────────────────────────────────────
  const alerts: AlertPayload[] = []

  // Check 1: High-frequency access
  const isHighFrequency = await checkHighFrequencyAccess(admin, record)
  if (isHighFrequency) {
    alerts.push({
      alert_type: 'HIGH_FREQUENCY_ACCESS',
      user_id: record.user_id,
      agency_id: record.agency_id,
      resource_id: record.resource_id,
      timestamp: record.created_at,
      details: `User has accessed PHI more than ${HIGH_FREQUENCY_THRESHOLD} times in the last ${HIGH_FREQUENCY_WINDOW_MINUTES} minutes`,
    })
  }

  // Check 2: Off-hours access
  const isOffHours = checkOffHoursAccess(record)
  if (isOffHours) {
    alerts.push({
      alert_type: 'OFF_HOURS_ACCESS',
      user_id: record.user_id,
      agency_id: record.agency_id,
      resource_id: record.resource_id,
      timestamp: record.created_at,
      details: 'PHI access occurred outside business hours (07:00–20:00 US/Eastern)',
    })
  }

  // Check 3: Cross-agency access
  const isCrossAgency = await checkCrossAgencyAccess(admin, record)
  if (isCrossAgency) {
    alerts.push({
      alert_type: 'CROSS_AGENCY_ACCESS',
      user_id: record.user_id,
      agency_id: record.agency_id,
      resource_id: record.resource_id,
      timestamp: record.created_at,
      details: 'User accessed a resource that does not belong to their agency',
    })
  }

  // ── Fire alerts (non-blocking) ───────────────────────────────────────────────
  if (alerts.length > 0) {
    // Process alerts in parallel, don't await
    alerts.forEach((alert) => {
      // Send Slack notification
      void sendSlackAlert(alert)
      // Send email notification
      void sendEmailAlert(alert)
      // Log to audit_log
      void logSecurityAlert(admin, alert)
    })
  }

  // ── Return immediately (don't block on notifications) ───────────────────────
  return NextResponse.json({
    success: true,
    alerts_fired: alerts.length,
    alert_types: alerts.map((a) => a.alert_type),
  })
}

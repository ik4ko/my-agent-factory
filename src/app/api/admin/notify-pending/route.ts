import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function getDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_ENABLED) {
    return NextResponse.json({ error: 'Not available' }, { status: 404 })
  }

  const secret = req.headers.get('authorization')
  if (secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getDb()

  // Get all unnotified open alerts, joined to member name via bob_member_id
  const { data: alerts, error: alertsErr } = await db
    .from('switch_alerts')
    .select(`
      id, alert_type, priority, previous_value, new_value,
      agency_id, bob_member_id,
      book_of_business!bob_member_id (full_name)
    `)
    .eq('status', 'open')
    .is('notified_at', null)

  if (alertsErr) {
    console.error('[notify-pending] alerts fetch error:', alertsErr.message)
    return NextResponse.json({ error: alertsErr.message }, { status: 500 })
  }

  if (!alerts?.length) {
    return NextResponse.json({ sent: 0, message: 'No pending alerts' })
  }

  console.log('[notify-pending] Found', alerts.length, 'unnotified alerts')

  // Group by agency_id (safer than broker_id — manually inserted alerts may lack broker_id)
  const byAgency: Record<string, typeof alerts> = {}
  for (const alert of alerts) {
    if (!alert.agency_id) continue
    if (!byAgency[alert.agency_id]) byAgency[alert.agency_id] = []
    byAgency[alert.agency_id].push(alert)
  }

  const { Resend } = await import('resend')
  const resend = new Resend(process.env.RESEND_API_KEY)
  const FROM = process.env.RESEND_FROM_EMAIL || 'alerts@aegissage.com'
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.aegissage.com'

  let sent = 0
  const results: Array<{ agency: string; email: string; count: number; status: string }> = []

  for (const [agencyId, agencyAlerts] of Object.entries(byAgency)) {
    // Find the agency owner broker's email
    const { data: broker } = await db
      .from('brokers')
      .select('email, first_name')
      .eq('agency_id', agencyId)
      .eq('role', 'agency_owner')
      .maybeSingle()

    if (!broker?.email) {
      console.warn('[notify-pending] No agency_owner email for agency:', agencyId)
      results.push({ agency: agencyId, email: 'none', count: agencyAlerts.length, status: 'skipped_no_email' })
      continue
    }

    const alertLines = agencyAlerts.map(a => {
      const member = (a as any).book_of_business
      const name = member?.full_name || 'Unknown Member'
      if (a.alert_type === 'termed') {
        return `🚨 Left Medicare Advantage: ${name}\n   Previous: ${a.previous_value || 'Unknown'}`
      }
      if (a.alert_type === 'pending_switch') {
        return `⚠️ Pending Plan Switch: ${name}\n   New plan: ${a.new_value || 'Unknown'}`
      }
      return `⚠️ Plan Changed: ${name}\n   Previous: ${a.previous_value || 'Unknown'} → ${a.new_value || 'Unknown'}`
    }).join('\n\n')

    const count = agencyAlerts.length
    const subject = `AegisSage Alert — ${count} member${count > 1 ? 's' : ''} need attention`

    try {
      await resend.emails.send({
        from: FROM,
        to: broker.email,
        subject,
        text: `Hi ${broker.first_name || 'there'},\n\nThe following members in your book require attention:\n\n${alertLines}\n\nLog in to view and manage these alerts:\n${APP_URL}/dashboard/alerts\n\n—AegisSage`,
      })

      // Mark all agency alerts as notified
      const { error: stampErr } = await db
        .from('switch_alerts')
        .update({ notified_at: new Date().toISOString(), notification_email: broker.email })
        .in('id', agencyAlerts.map(a => a.id))

      if (stampErr) console.error('[notify-pending] stamp error:', stampErr.message)

      sent += count
      results.push({ agency: agencyId, email: broker.email, count, status: 'sent' })
      console.log('[notify-pending] Sent', count, 'alert(s) to', broker.email)
    } catch (err: any) {
      console.error('[notify-pending] email error for agency', agencyId, ':', err.message)
      results.push({ agency: agencyId, email: broker.email, count, status: 'email_failed' })
    }
  }

  return NextResponse.json({ sent, results })
}

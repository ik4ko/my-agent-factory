import { getResend, FROM_EMAIL } from './resend-client'
import {
  switchAlertEmail, vccDeadlineEmail, aorSignedEmail,
  teamInviteEmail, weeklyDigestEmail,
} from './templates'
import { createServiceClient } from '@/lib/supabase/service'
import { withRetry, withRetrySafe } from '@/lib/utils/retry'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.aegissage.com'

// -- 1. Switch Alerts -------------------------------------------------------
// Called after extension sync detects missing members -- fires per-switch emails

export async function notifyNewSwitchAlerts(uploadId: string, agencyId: string): Promise<void> {
  if (!process.env.RESEND_API_KEY?.startsWith('re_')) {
    console.error('[email] RESEND_API_KEY is not set — notifyNewSwitchAlerts skipped')
    return
  }

  try {
    const supabase = createServiceClient()

    const { data: alerts } = await supabase
      .from('switch_alerts')
      .select('id, broker_id, bob_member_id, ghl_contact_id, carrier, alert_type')
      .eq('upload_id', uploadId)
      .eq('agency_id', agencyId)
      .eq('alert_type', 'missing_from_roster')
      .eq('status', 'open')

    if (!alerts?.length) return

    // Batch-fetch member names from book_of_business
    const bobIds = [...new Set(alerts.map(a => a.bob_member_id).filter(Boolean))] as string[]
    const { data: bobMembers } = await supabase
      .from('book_of_business')
      .select('id, full_name')
      .in('id', bobIds)

    const bobNameMap = new Map((bobMembers ?? []).map(m => [m.id, m.full_name ?? 'Unknown']))

    // Fall back to ghl_contacts for legacy alerts
    const legacyContactIds = alerts
      .filter(a => !a.bob_member_id)
      .map(a => a.ghl_contact_id)
      .filter(Boolean)
    let ghlNameMap = new Map<string, string>()
    if (legacyContactIds.length > 0) {
      const { data: contacts } = await supabase
        .from('ghl_contacts')
        .select('ghl_contact_id, full_name')
        .in('ghl_contact_id', legacyContactIds)
      ghlNameMap = new Map((contacts ?? []).map(c => [c.ghl_contact_id, c.full_name ?? 'Unknown']))
    }

    const getClientName = (a: typeof alerts[0]) =>
      (a.bob_member_id && bobNameMap.get(a.bob_member_id)) ||
      (a.ghl_contact_id && ghlNameMap.get(a.ghl_contact_id)) ||
      'Unknown Client'

    // Group by broker_id
    const byBroker = new Map<string, typeof alerts>()
    for (const a of alerts) {
      if (!a.broker_id) continue
      if (!byBroker.has(a.broker_id)) byBroker.set(a.broker_id, [])
      byBroker.get(a.broker_id)!.push(a)
    }

    // Process each broker independently -- one failure must not block others
    await Promise.allSettled(
      Array.from(byBroker.entries()).map(async ([brokerId, brokerAlerts]) => {
        try {
          const { data: broker } = await supabase
            .from('brokers')
            .select('first_name, last_name, email')
            .eq('id', brokerId)
            .maybeSingle()

          if (!broker?.email) return

          const brokerName = `${broker.first_name} ${broker.last_name}`

          // Send one immediate email per alert (up to 5), each isolated
          await Promise.allSettled(
            brokerAlerts.slice(0, 5).map(async alert => {
              try {
                const clientName = getClientName(alert)
                const { subject, html } = switchAlertEmail({
                  brokerName,
                  clientName,
                  carrier: alert.carrier ?? 'Unknown Carrier',
                  alertType: alert.alert_type,
                  dashboardUrl: `${APP_URL}/dashboard/alerts`,
                })
                await withRetry(
                  () => getResend().emails.send({ from: FROM_EMAIL, to: broker.email!, subject, html }),
                  { maxAttempts: 2, baseDelayMs: 400, label: `notifyNewSwitchAlerts alert=${alert.id}` }
                )
              } catch (alertErr) {
                console.error(`[notifyNewSwitchAlerts] email failed for alert ${alert.id}:`, alertErr)
              }
            })
          )

          // Summary email if more than 5 alerts
          if (brokerAlerts.length > 5) {
            try {
              const { subject, html } = switchAlertEmail({
                brokerName,
                clientName: `${brokerAlerts.length} clients`,
                carrier: brokerAlerts[0]?.carrier ?? 'Multiple Carriers',
                alertType: 'missing_from_roster',
                dashboardUrl: `${APP_URL}/dashboard/alerts`,
              })
              await withRetry(
                () => getResend().emails.send({ from: FROM_EMAIL, to: broker.email!, subject, html }),
                { maxAttempts: 2, baseDelayMs: 400, label: `notifyNewSwitchAlerts summary broker=${brokerId}` }
              )
            } catch (summaryErr) {
              console.error(`[notifyNewSwitchAlerts] summary email failed for broker ${brokerId}:`, summaryErr)
            }
          }
        } catch (brokerErr) {
          console.error(`[notifyNewSwitchAlerts] broker ${brokerId} processing failed:`, brokerErr)
        }
      })
    )
  } catch (err) {
    console.error('[notifyNewSwitchAlerts]', err)
  }
}

// -- 2. VCC Deadlines -------------------------------------------------------
// Called by the daily notifications cron -- finds forms sending within 7 days

export async function notifyVCCDeadlines(): Promise<void> {
  try {
    const supabase = createServiceClient()
    const now = new Date()
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

    const { data: upcoming } = await supabase
      .from('vcc_submissions')
      .select('id, agency_id, broker_id, client_name, carrier, send_scheduled_at')
      .eq('fax_status', 'scheduled')
      .gte('send_scheduled_at', now.toISOString())
      .lte('send_scheduled_at', in7Days.toISOString())

    if (!upcoming?.length) return

    for (const sub of upcoming) {
      if (!sub.broker_id) continue

      const { data: broker } = await supabase
        .from('brokers')
        .select('first_name, last_name, email')
        .eq('id', sub.broker_id)
        .maybeSingle()

      if (!broker?.email) continue

      const sendDate = new Date(sub.send_scheduled_at)
      const daysRemaining = Math.max(1, Math.ceil((sendDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))

      const { subject, html } = vccDeadlineEmail({
        brokerName: `${broker.first_name} ${broker.last_name}`,
        clientName: sub.client_name,
        carrier: sub.carrier,
        daysRemaining,
        dashboardUrl: `${APP_URL}/dashboard/vcc`,
      })

      await getResend().emails.send({ from: FROM_EMAIL, to: broker.email, subject, html })
    }
  } catch (err) {
    console.error('[notifyVCCDeadlines]', err)
  }
}

// -- 3. AOR Signed ----------------------------------------------------------
// Called after client signs AOR -- notifies the assigned broker

export async function notifyAORSigned(submissionId: string): Promise<void> {
  try {
    const supabase = createServiceClient()

    const { data: sub } = await supabase
      .from('aor_submissions')
      .select('broker_id, client_name, signature_method')
      .eq('id', submissionId)
      .maybeSingle()

    if (!sub?.broker_id) return

    const { data: broker } = await supabase
      .from('brokers')
      .select('first_name, last_name, email')
      .eq('id', sub.broker_id)
      .maybeSingle()

    if (!broker?.email) return

    const { subject, html } = aorSignedEmail({
      brokerName: `${broker.first_name} ${broker.last_name}`,
      clientName: sub.client_name,
      signatureMethod: sub.signature_method ?? 'email_link',
      dashboardUrl: `${APP_URL}/dashboard/aor`,
    })

    await getResend().emails.send({ from: FROM_EMAIL, to: broker.email, subject, html })
  } catch (err) {
    console.error('[notifyAORSigned]', err)
  }
}

// -- 4. Team Invite ---------------------------------------------------------
// Called after broker insert in /api/team/invite

// Returns true when Resend accepted the email. The invite route depends on
// this signal — this is now the only email carrying the invite link.
export async function sendTeamInviteEmail(params: {
  inviteeEmail: string
  inviterName: string
  agencyName: string
  role: string
  inviteUrl: string
}): Promise<boolean> {
  try {
    const { subject, html } = teamInviteEmail({
      inviterName: params.inviterName,
      agencyName: params.agencyName,
      role: params.role,
      inviteUrl: params.inviteUrl,
      expiresIn: '7 days',
    })

    const { error } = await getResend().emails.send({
      from: FROM_EMAIL,
      to: params.inviteeEmail,
      subject,
      html,
    })
    if (error) {
      console.error('[sendTeamInviteEmail]', error.message)
      return false
    }
    return true
  } catch (err) {
    console.error('[sendTeamInviteEmail]', err)
    return false
  }
}

// -- 5b. MARx Switch Alert (immediate, per-client) --------------------------
// Called by /api/marx/verify when a change is confirmed via CMS MARx lookup.

export async function sendSwitchAlertEmail(
  toEmail: string,
  data: {
    memberName: string
    // Previous plan/carrier (from roster — what broker enrolled them in)
    previousPlanName: string
    previousCarrier: string
    // New plan/carrier (from MARx — what CMS shows now)
    newPlanName: string
    newCarrier: string
    switchType: string
    // Pending switch extras
    futurePlanName?: string
    futureEffectiveDate?: string
    detectedVia: string
    alertUrl: string
  }
): Promise<void> {
  if (!process.env.RESEND_API_KEY?.startsWith('re_')) {
    console.error('[email] RESEND_API_KEY is not set — sendSwitchAlertEmail skipped')
    return
  }

  let subject: string
  let html: string

  const styles = `
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#0f172a; color:#e2e8f0; margin:0; padding:0; }
    .wrapper { max-width:600px; margin:0 auto; padding:32px 16px; }
    .card { background:#1e293b; border-radius:16px; padding:32px; border:1px solid #334155; }
    .logo { font-size:11px; font-weight:900; letter-spacing:0.2em; text-transform:uppercase; color:#6366f1; margin-bottom:24px; }
    .badge { display:inline-block; padding:4px 10px; border-radius:6px; font-size:10px; font-weight:900; text-transform:uppercase; letter-spacing:0.1em; margin-bottom:16px; }
    .badge-red    { background:#450a0a; color:#f87171; border:1px solid #7f1d1d; }
    .badge-orange { background:#431407; color:#fb923c; border:1px solid #7c2d12; }
    .badge-yellow { background:#422006; color:#fbbf24; border:1px solid #78350f; }
    h2 { font-size:20px; font-weight:900; color:#f8fafc; margin:0 0 8px; }
    .subtitle { font-size:13px; color:#94a3b8; margin:0 0 24px; }
    .plan-row { display:flex; gap:12px; margin-bottom:20px; }
    .plan-box { flex:1; background:#0f172a; border-radius:10px; padding:14px; border:1px solid #334155; }
    .plan-label { font-size:9px; font-weight:900; text-transform:uppercase; letter-spacing:0.15em; color:#64748b; margin-bottom:6px; }
    .plan-name { font-size:13px; font-weight:700; color:#f1f5f9; margin-bottom:4px; }
    .plan-carrier { font-size:11px; color:#94a3b8; }
    .arrow { display:flex; align-items:center; padding-top:28px; color:#475569; font-size:18px; }
    .details { background:#0f172a; border-radius:10px; padding:14px; margin-bottom:24px; border:1px solid #1e293b; }
    .detail-row { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #1e293b; font-size:12px; }
    .detail-row:last-child { border-bottom:none; }
    .detail-label { color:#64748b; font-weight:700; }
    .detail-value { color:#e2e8f0; font-weight:600; }
    .cta { display:block; text-align:center; background:#6366f1; color:#fff!important; padding:14px 24px; border-radius:10px; font-weight:900; font-size:13px; text-decoration:none; letter-spacing:0.05em; text-transform:uppercase; }
    .footer { text-align:center; margin-top:20px; font-size:10px; color:#475569; }
  `.replace(/\n\s+/g, ' ').trim()

  if (data.switchType === 'future_plan_change') {
    subject = `${data.memberName} has a plan change coming${data.futureEffectiveDate ? ` (eff. ${data.futureEffectiveDate})` : ''}`
    html = `<!DOCTYPE html><html><head><style>${styles}</style></head><body>
<div class="wrapper"><div class="card">
  <div class="logo">AegisSage</div>
  <span class="badge badge-yellow">⚠ Upcoming Switch</span>
  <h2>${data.memberName} is switching plans</h2>
  <p class="subtitle">A plan change is scheduled — you still have time to reach out and retain this client.</p>
  <div class="plan-row">
    <div class="plan-box">
      <div class="plan-label">Current Plan</div>
      <div class="plan-name">${data.previousPlanName || 'On file'}</div>
      <div class="plan-carrier">${data.previousCarrier}</div>
    </div>
    <div class="arrow">→</div>
    <div class="plan-box" style="border-color:#78350f;">
      <div class="plan-label" style="color:#d97706;">Incoming Plan</div>
      <div class="plan-name">${data.futurePlanName || data.newPlanName || 'Unknown'}</div>
      <div class="plan-carrier">${data.newCarrier}</div>
    </div>
  </div>
  <div class="details">
    ${data.futureEffectiveDate ? `<div class="detail-row"><span class="detail-label">Effective Date</span><span class="detail-value">${data.futureEffectiveDate}</span></div>` : ''}
    <div class="detail-row"><span class="detail-label">Detected Via</span><span class="detail-value">${data.detectedVia}</span></div>
  </div>
  <a href="${data.alertUrl}" class="cta">View Alert &amp; Take Action</a>
  <p class="footer">AegisSage Medicare Retention Platform &middot; You are receiving this because a client plan change was detected.</p>
</div></div></body></html>`

  } else if (data.switchType === 'termed' || data.switchType === 'no_ma_plan') {
    subject = `${data.memberName} may no longer have active Medicare coverage`
    html = `<!DOCTYPE html><html><head><style>${styles}</style></head><body>
<div class="wrapper"><div class="card">
  <div class="logo">AegisSage</div>
  <span class="badge badge-red">🚨 Critical — No Active Plan</span>
  <h2>${data.memberName} no longer has an active plan</h2>
  <p class="subtitle">This client does not appear on Medicare Advantage as of today's MARx check. Immediate outreach is recommended.</p>
  <div class="plan-row">
    <div class="plan-box">
      <div class="plan-label">Was Enrolled In</div>
      <div class="plan-name">${data.previousPlanName || 'Previously enrolled'}</div>
      <div class="plan-carrier">${data.previousCarrier}</div>
    </div>
    <div class="arrow">→</div>
    <div class="plan-box" style="border-color:#7f1d1d;">
      <div class="plan-label" style="color:#ef4444;">Current Status</div>
      <div class="plan-name" style="color:#f87171;">No Active MA Plan</div>
      <div class="plan-carrier">May have moved to Original Medicare, lost coverage, or disenrolled</div>
    </div>
  </div>
  <div class="details">
    <div class="detail-row"><span class="detail-label">Detected Via</span><span class="detail-value">${data.detectedVia}</span></div>
  </div>
  <a href="${data.alertUrl}" class="cta">View Alert &amp; Take Action</a>
  <p class="footer">AegisSage Medicare Retention Platform &middot; You are receiving this because a coverage gap was detected.</p>
</div></div></body></html>`

  } else if (data.switchType === 'carrier_switch') {
    subject = `${data.memberName} appears to have switched carriers`
    html = `<!DOCTYPE html><html><head><style>${styles}</style></head><body>
<div class="wrapper"><div class="card">
  <div class="logo">AegisSage</div>
  <span class="badge badge-red">Carrier Switch Detected</span>
  <h2>${data.memberName} moved to a different carrier</h2>
  <p class="subtitle">This client is no longer on ${data.previousCarrier}. They have switched to a different insurance carrier.</p>
  <div class="plan-row">
    <div class="plan-box">
      <div class="plan-label">Previous Carrier</div>
      <div class="plan-name">${data.previousPlanName || 'Previous plan'}</div>
      <div class="plan-carrier">${data.previousCarrier}</div>
    </div>
    <div class="arrow">→</div>
    <div class="plan-box" style="border-color:#7f1d1d;">
      <div class="plan-label" style="color:#ef4444;">New Carrier</div>
      <div class="plan-name">${data.newPlanName || 'New plan'}</div>
      <div class="plan-carrier">${data.newCarrier}</div>
    </div>
  </div>
  <div class="details">
    <div class="detail-row"><span class="detail-label">Detected Via</span><span class="detail-value">${data.detectedVia}</span></div>
  </div>
  <a href="${data.alertUrl}" class="cta">View Alert &amp; Take Action</a>
  <p class="footer">AegisSage Medicare Retention Platform &middot; You are receiving this because a carrier change was detected in MARx.</p>
</div></div></body></html>`

  } else {
    // Generic plan switch (same carrier, different plan)
    subject = `${data.memberName} may be switching plans`
    html = `<!DOCTYPE html><html><head><style>${styles}</style></head><body>
<div class="wrapper"><div class="card">
  <div class="logo">AegisSage</div>
  <span class="badge badge-orange">Plan Change Detected</span>
  <h2>${data.memberName} has a new plan</h2>
  <p class="subtitle">This client's Medicare Advantage plan has changed. They are still on Medicare Advantage.</p>
  <div class="plan-row">
    <div class="plan-box">
      <div class="plan-label">Previous Plan</div>
      <div class="plan-name">${data.previousPlanName || 'Previous plan on file'}</div>
      <div class="plan-carrier">${data.previousCarrier}</div>
    </div>
    <div class="arrow">→</div>
    <div class="plan-box" style="border-color:#7c2d12;">
      <div class="plan-label" style="color:#fb923c;">New Plan</div>
      <div class="plan-name">${data.newPlanName || 'New plan detected'}</div>
      <div class="plan-carrier">${data.newCarrier}</div>
    </div>
  </div>
  <div class="details">
    <div class="detail-row"><span class="detail-label">Detected Via</span><span class="detail-value">${data.detectedVia}</span></div>
  </div>
  <a href="${data.alertUrl}" class="cta">View Alert &amp; Take Action</a>
  <p class="footer">AegisSage Medicare Retention Platform &middot; You are receiving this because a plan change was detected in MARx.</p>
</div></div></body></html>`
  }

  try {
    await getResend().emails.send({
      from: FROM_EMAIL,
      to:   toEmail,
      subject,
      html,
    })
  } catch (err) {
    console.error('[sendSwitchAlertEmail]', err)
    throw err  // re-throw so callers can retry or log delivery failure
  }
}

// -- 5a. Open Alert Notifications -------------------------------------------
// Called every cron run -- finds open alerts with no notified_at, groups by
// broker, sends one summary email per broker, then stamps notified_at ONLY on
// successful sends. Failed brokers remain unnotified for next cron retry.

export async function notifyOpenAlerts(): Promise<void> {
  if (!process.env.RESEND_API_KEY?.startsWith('re_')) {
    console.error('[email] RESEND_API_KEY is not set — notifyOpenAlerts skipped')
    return
  }

  try {
    const supabase = createServiceClient()

    const { data: alerts } = await supabase
      .from('switch_alerts')
      .select('id, agency_id, broker_id, bob_member_id, alert_type, switch_type, carrier, previous_plan_code, new_plan_code, previous_value, new_value')
      .eq('status', 'open')
      .is('notified_at', null)

    if (!alerts?.length) return

    const bobIds = [...new Set(alerts.map(a => a.bob_member_id).filter(Boolean))] as string[]
    const { data: bobMembers } = await supabase
      .from('book_of_business')
      .select('id, full_name')
      .in('id', bobIds)
    const nameMap = new Map((bobMembers ?? []).map(m => [m.id, m.full_name ?? 'Unknown']))

    const byBroker = new Map<string, typeof alerts>()
    for (const a of alerts) {
      if (!a.broker_id) continue
      if (!byBroker.has(a.broker_id)) byBroker.set(a.broker_id, [])
      byBroker.get(a.broker_id)!.push(a)
    }

    const now = new Date().toISOString()

    // Process each broker independently -- one failure must not block others
    const brokerResults = await Promise.allSettled(
      Array.from(byBroker.entries()).map(async ([brokerId, brokerAlerts]) => {
        const { data: broker } = await supabase
          .from('brokers')
          .select('first_name, last_name, email')
          .eq('id', brokerId)
          .maybeSingle()

        if (!broker?.email) return { brokerId, skipped: true, reason: 'no email' }

        const alertLines = brokerAlerts.map(a => {
          const name = nameMap.get(a.bob_member_id ?? '') ?? 'Unknown Client'
          const prev = a.previous_plan_code ?? a.previous_value ?? 'Unknown'
          const next = a.new_plan_code ?? a.new_value ?? 'Unknown'
          const carrier = a.carrier ?? 'Unknown'
          if (a.alert_type === 'termed' || a.switch_type === 'termed') {
            return `- ${name} -- No longer on Medicare Advantage (was: ${carrier} ${prev})`
          }
          if (a.alert_type === 'aor_change') {
            return `- ${name} -- AOR change detected (may have switched brokers) -- ${carrier}`
          }
          return `- ${name} -- Plan switch: ${prev} -> ${next} (${carrier})`
        }).join('\n')

        const count = brokerAlerts.length
        const subject = `AegisSage -- ${count} client${count > 1 ? 's' : ''} need${count === 1 ? 's' : ''} attention`
        const html = `<p>Hi ${broker.first_name},</p>
<p>AegisSage detected the following changes in your book of business:</p>
<pre style="font-family:monospace;background:#f4f4f4;padding:16px;border-radius:8px;white-space:pre-wrap">${alertLines}</pre>
<p><a href="${APP_URL}/dashboard/alerts" style="background:#6366f1;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold">View All Alerts</a></p>
<p style="color:#888;font-size:12px">AegisSage Medicare Retention Platform</p>`

        const alertIds = brokerAlerts.map(a => a.id)
        let emailSent = false
        let emailError: string | null = null

        try {
          await withRetry(
            () => getResend().emails.send({ from: FROM_EMAIL, to: broker.email!, subject, html }),
            { maxAttempts: 3, baseDelayMs: 500, label: `notifyOpenAlerts broker=${brokerId}` }
          )
          emailSent = true
        } catch (sendErr) {
          emailError = sendErr instanceof Error ? sendErr.message : String(sendErr)
          console.error(`[notifyOpenAlerts] email failed for broker ${brokerId}:`, emailError)
        }

        // Stamp notified_at ONLY on successful send -- failed alerts stay unnotified for retry
        if (emailSent) {
          await withRetrySafe<void>(
            async () => {
              const res = await supabase
                .from('switch_alerts')
                .update({ notified_at: now, notification_email: broker.email })
                .in('id', alertIds)
              if (res.error) throw res.error
            },
            { maxAttempts: 3, baseDelayMs: 200, label: 'notifyOpenAlerts stamp notified_at' }
          )
        }

        // Write delivery log for every alert in this batch
        const deliveryLogs = alertIds.map(alertId => ({
          alert_id:         alertId,
          delivery_status:  emailSent ? 'sent' : 'failed',
          delivery_channel: 'email',
          recipient_email:  broker.email,
          error_message:    emailError,
          attempted_at:     now,
        }))
        await withRetrySafe<void>(
          async () => {
            const res = await supabase.from('alert_delivery_log').insert(deliveryLogs)
            if (res.error) throw res.error
          },
          { maxAttempts: 2, baseDelayMs: 200, label: 'notifyOpenAlerts delivery log' }
        )

        return { brokerId, sent: emailSent, alertCount: brokerAlerts.length, error: emailError }
      })
    )

    const failCount = brokerResults.filter(r =>
      r.status === 'rejected' ||
      (r.status === 'fulfilled' && r.value && !(r.value as any).skipped && !(r.value as any).sent)
    ).length
    if (failCount > 0) {
      console.error(`[notifyOpenAlerts] ${failCount} broker(s) had delivery failures -- will retry next cron run`)
    }
  } catch (err) {
    console.error('[notifyOpenAlerts]', err)
  }
}

// -- 5. Weekly Digests ------------------------------------------------------
// Called every Monday by the notifications cron

export async function sendWeeklyDigests(): Promise<void> {
  try {
    const supabase = createServiceClient()

    const { data: agencies } = await supabase
      .from('agencies')
      .select('id, name')

    if (!agencies?.length) return

    for (const agency of agencies) {
      const { data: brokers } = await supabase
        .from('brokers')
        .select('id, user_id, first_name, last_name, email, role')
        .eq('agency_id', agency.id)
        .not('email', 'is', null)

      if (!brokers?.length) continue

      const [{ count: openAlerts }, { count: vccPending }, { count: aorPending }, { count: clientsAtRisk }] =
        await Promise.all([
          supabase.from('switch_alerts').select('id', { count: 'exact', head: true })
            .eq('agency_id', agency.id).eq('status', 'open'),
          supabase.from('vcc_submissions').select('id', { count: 'exact', head: true })
            .eq('agency_id', agency.id).eq('fax_status', 'scheduled'),
          supabase.from('aor_submissions').select('id', { count: 'exact', head: true })
            .eq('agency_id', agency.id).eq('status', 'client_signed'),
          supabase.from('ghl_contacts').select('id', { count: 'exact', head: true })
            .eq('agency_id', agency.id).in('risk_level', ['critical', 'high']),
        ])

      // Each broker digest is isolated -- one send failure won't block the rest
      await Promise.allSettled(
        brokers.map(async broker => {
          try {
            const { subject, html } = weeklyDigestEmail({
              brokerName: `${broker.first_name} ${broker.last_name}`,
              agencyName: agency.name,
              openAlerts: openAlerts ?? 0,
              vccPending: vccPending ?? 0,
              aorPending: aorPending ?? 0,
              clientsAtRisk: clientsAtRisk ?? 0,
              dashboardUrl: `${APP_URL}/dashboard`,
            })
            await withRetry(
              () => getResend().emails.send({ from: FROM_EMAIL, to: broker.email!, subject, html }),
              { maxAttempts: 2, baseDelayMs: 500, label: `sendWeeklyDigests broker=${broker.id}` }
            )
          } catch (brokerErr) {
            console.error(`[sendWeeklyDigests] email failed for broker ${broker.id}:`, brokerErr)
          }
        })
      )
    }
  } catch (err) {
    console.error('[sendWeeklyDigests]', err)
  }
}

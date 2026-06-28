module.exports=[656270,e=>{"use strict";var a=e.i(246245);let t=process.env.RESEND_FROM_EMAIL??"alerts@aegissage.com",r=null;function i(){if(!r){let e=process.env.RESEND_API_KEY;if(!e)throw console.error("[email] RESEND_API_KEY is not set"),Error("RESEND_API_KEY is not configured");r=new a.Resend(e)}return r}let n="#6366f1",l="#0f172a",s="#e2e8f0",o="#94a3b8",d="#334155";function c(e,a){return`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${e}</title>
</head>
<body style="margin:0;padding:0;background:${l};font-family:'Segoe UI',Arial,sans-serif;color:${s};">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <!-- Header -->
        <tr>
          <td style="padding:0 0 28px 0;">
            <span style="font-size:18px;font-weight:900;letter-spacing:0.12em;text-transform:uppercase;color:${n};">AegisSage</span>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="background:#1e293b;border:1px solid ${d};border-radius:16px;padding:36px;">
            ${a}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 0 0 0;text-align:center;">
            <p style="font-size:10px;color:${o};text-transform:uppercase;letter-spacing:0.1em;margin:0;">
              Not connected with or endorsed by the U.S. government or the federal Medicare program.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`}function p(e,a=n){return`<span style="display:inline-block;background:${a}22;color:${a};font-size:10px;font-weight:900;letter-spacing:0.1em;text-transform:uppercase;padding:3px 10px;border-radius:999px;border:1px solid ${a}44;">${e}</span>`}function m(e){return`<h1 style="margin:0 0 8px 0;font-size:24px;font-weight:900;text-transform:uppercase;letter-spacing:-0.02em;color:${s};">${e}</h1>`}function f(e,a=!1){return`<p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:${a?o:s};">${e}</p>`}function g(e,a){return`<a href="${a}" style="display:inline-block;margin-top:8px;padding:12px 28px;background:${n};color:#fff;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:0.1em;border-radius:10px;text-decoration:none;">${e}</a>`}function b(e,a){return`<tr>
    <td style="padding:8px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:${o};width:40%;">${e}</td>
    <td style="padding:8px 0;font-size:13px;font-weight:600;color:${s};">${a}</td>
  </tr>`}function v(e){let a="missing_from_roster"===e.alertType?"Missing From Roster":"New Enrollment",t="missing_from_roster"===e.alertType?`${e.clientName} may have switched plans`:`${e.clientName} may be switching plans`;return{subject:t,html:c(t,`
    ${p(a,"#f59e0b")}
    <div style="margin-top:20px;">${m("Churn Alert")}</div>
    ${f(`Hi ${e.brokerName},`,!1)}
    ${f("A plan change event was detected for one of your clients. Review and take action.",!0)}
    <table style="width:100%;border-collapse:collapse;margin:16px 0 24px;">
      ${b("Client",e.clientName)}
      ${b("Carrier",e.carrier)}
      ${b("Alert Type",a)}
    </table>
    ${g("View in Dashboard",e.dashboardUrl)}
  `)}}var h=e.i(16253),u=e.i(60735);let y=process.env.NEXT_PUBLIC_APP_URL??"https://app.aegissage.com";async function w(e,a){if(!process.env.RESEND_API_KEY?.startsWith("re_"))return void console.error("[email] RESEND_API_KEY is not set — notifyNewSwitchAlerts skipped");try{let r=(0,h.createServiceClient)(),{data:n}=await r.from("switch_alerts").select("id, broker_id, bob_member_id, ghl_contact_id, carrier, alert_type").eq("upload_id",e).eq("agency_id",a).eq("alert_type","missing_from_roster").eq("status","open");if(!n?.length)return;let l=[...new Set(n.map(e=>e.bob_member_id).filter(Boolean))],{data:s}=await r.from("book_of_business").select("id, full_name").in("id",l),o=new Map((s??[]).map(e=>[e.id,e.full_name??"Unknown"])),d=n.filter(e=>!e.bob_member_id).map(e=>e.ghl_contact_id).filter(Boolean),c=new Map;if(d.length>0){let{data:e}=await r.from("ghl_contacts").select("ghl_contact_id, full_name").in("ghl_contact_id",d);c=new Map((e??[]).map(e=>[e.ghl_contact_id,e.full_name??"Unknown"]))}let p=new Map;for(let e of n)e.broker_id&&(p.has(e.broker_id)||p.set(e.broker_id,[]),p.get(e.broker_id).push(e));await Promise.allSettled(Array.from(p.entries()).map(async([e,a])=>{try{let{data:n}=await r.from("brokers").select("first_name, last_name, email").eq("id",e).maybeSingle();if(!n?.email)return;let l=`${n.first_name} ${n.last_name}`;if(await Promise.allSettled(a.slice(0,5).map(async e=>{try{let a=e.bob_member_id&&o.get(e.bob_member_id)||e.ghl_contact_id&&c.get(e.ghl_contact_id)||"Unknown Client",{subject:r,html:s}=v({brokerName:l,clientName:a,carrier:e.carrier??"Unknown Carrier",alertType:e.alert_type,dashboardUrl:`${y}/dashboard/alerts`});await (0,u.withRetry)(()=>i().emails.send({from:t,to:n.email,subject:r,html:s}),{maxAttempts:2,baseDelayMs:400,label:`notifyNewSwitchAlerts alert=${e.id}`})}catch(a){console.error(`[notifyNewSwitchAlerts] email failed for alert ${e.id}:`,a)}})),a.length>5)try{let{subject:r,html:s}=v({brokerName:l,clientName:`${a.length} clients`,carrier:a[0]?.carrier??"Multiple Carriers",alertType:"missing_from_roster",dashboardUrl:`${y}/dashboard/alerts`});await (0,u.withRetry)(()=>i().emails.send({from:t,to:n.email,subject:r,html:s}),{maxAttempts:2,baseDelayMs:400,label:`notifyNewSwitchAlerts summary broker=${e}`})}catch(a){console.error(`[notifyNewSwitchAlerts] summary email failed for broker ${e}:`,a)}}catch(a){console.error(`[notifyNewSwitchAlerts] broker ${e} processing failed:`,a)}}))}catch(e){console.error("[notifyNewSwitchAlerts]",e)}}async function _(){try{let e=(0,h.createServiceClient)(),a=new Date,r=new Date(a.getTime()+6048e5),{data:n}=await e.from("vcc_submissions").select("id, agency_id, broker_id, client_name, carrier, send_scheduled_at").eq("fax_status","scheduled").gte("send_scheduled_at",a.toISOString()).lte("send_scheduled_at",r.toISOString());if(!n?.length)return;for(let r of n){if(!r.broker_id)continue;let{data:n}=await e.from("brokers").select("first_name, last_name, email").eq("id",r.broker_id).maybeSingle();if(!n?.email)continue;let l=new Date(r.send_scheduled_at),s=Math.max(1,Math.ceil((l.getTime()-a.getTime())/864e5)),{subject:o,html:d}=function(e){let a=e.daysRemaining<=2?"#ef4444":e.daysRemaining<=5?"#f59e0b":"#6366f1",t=`${e.clientName}'s carrier form sends in ${e.daysRemaining} day${1===e.daysRemaining?"":"s"}`;return{subject:t,html:c(t,`
    ${p(`${e.daysRemaining} Days Remaining`,a)}
    <div style="margin-top:20px;">${m("VCC Form Deadline")}</div>
    ${f(`Hi ${e.brokerName},`,!1)}
    ${f("A carrier form for your client is scheduled to be faxed soon. Confirm all details are correct.",!0)}
    <table style="width:100%;border-collapse:collapse;margin:16px 0 24px;">
      ${b("Client",e.clientName)}
      ${b("Carrier",e.carrier)}
      ${b("Days Until Send",String(e.daysRemaining))}
    </table>
    ${g("Review VCC Form",e.dashboardUrl)}
  `)}}({brokerName:`${n.first_name} ${n.last_name}`,clientName:r.client_name,carrier:r.carrier,daysRemaining:s,dashboardUrl:`${y}/dashboard/vcc`});await i().emails.send({from:t,to:n.email,subject:o,html:d})}}catch(e){console.error("[notifyVCCDeadlines]",e)}}async function x(e){try{var a;let r,n,{subject:l,html:s}=(a={inviterName:e.inviterName,agencyName:e.agencyName,role:e.role,inviteUrl:e.inviteUrl,expiresIn:"7 days"},r="agency_admin"===a.role?"Manager":"customer_service"===a.role?"Customer Service":"Broker",{subject:n=`You've been invited to join ${a.agencyName} on AegisSage`,html:c(n,`
    ${p("Team Invitation")}
    <div style="margin-top:20px;">${m("You're Invited")}</div>
    ${f(`<strong>${a.inviterName}</strong> has invited you to join <strong>${a.agencyName}</strong> as a ${r}.`,!1)}
    ${f(`AegisSage is a Medicare retention and compliance platform. Your invite expires in ${a.expiresIn}.`,!0)}
    ${g("Accept Invitation",a.inviteUrl)}
    <p style="margin-top:20px;font-size:11px;color:${o};">If you weren't expecting this invite, you can safely ignore this email.</p>
  `)}),{error:d}=await i().emails.send({from:t,to:e.inviteeEmail,subject:l,html:s});if(d)return console.error("[sendTeamInviteEmail]",d.message),!1;return!0}catch(e){return console.error("[sendTeamInviteEmail]",e),!1}}async function $(e,a){let r,n;if(!process.env.RESEND_API_KEY?.startsWith("re_"))return void console.error("[email] RESEND_API_KEY is not set — sendSwitchAlertEmail skipped");let l=`
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
  `.replace(/\n\s+/g," ").trim();"future_plan_change"===a.switchType?(r=`${a.memberName} has a plan change coming${a.futureEffectiveDate?` (eff. ${a.futureEffectiveDate})`:""}`,n=`<!DOCTYPE html><html><head><style>${l}</style></head><body>
<div class="wrapper"><div class="card">
  <div class="logo">AegisSage</div>
  <span class="badge badge-yellow">⚠ Upcoming Switch</span>
  <h2>${a.memberName} is switching plans</h2>
  <p class="subtitle">A plan change is scheduled — you still have time to reach out and retain this client.</p>
  <div class="plan-row">
    <div class="plan-box">
      <div class="plan-label">Current Plan</div>
      <div class="plan-name">${a.previousPlanName||"On file"}</div>
      <div class="plan-carrier">${a.previousCarrier}</div>
    </div>
    <div class="arrow">→</div>
    <div class="plan-box" style="border-color:#78350f;">
      <div class="plan-label" style="color:#d97706;">Incoming Plan</div>
      <div class="plan-name">${a.futurePlanName||a.newPlanName||"Unknown"}</div>
      <div class="plan-carrier">${a.newCarrier}</div>
    </div>
  </div>
  <div class="details">
    ${a.futureEffectiveDate?`<div class="detail-row"><span class="detail-label">Effective Date</span><span class="detail-value">${a.futureEffectiveDate}</span></div>`:""}
    <div class="detail-row"><span class="detail-label">Detected Via</span><span class="detail-value">${a.detectedVia}</span></div>
  </div>
  <a href="${a.alertUrl}" class="cta">View Alert &amp; Take Action</a>
  <p class="footer">AegisSage Medicare Retention Platform &middot; You are receiving this because a client plan change was detected.</p>
</div></div></body></html>`):"termed"===a.switchType||"no_ma_plan"===a.switchType?(r=`${a.memberName} may no longer have active Medicare coverage`,n=`<!DOCTYPE html><html><head><style>${l}</style></head><body>
<div class="wrapper"><div class="card">
  <div class="logo">AegisSage</div>
  <span class="badge badge-red">🚨 Critical — No Active Plan</span>
  <h2>${a.memberName} no longer has an active plan</h2>
  <p class="subtitle">This client does not appear on Medicare Advantage as of today's MARx check. Immediate outreach is recommended.</p>
  <div class="plan-row">
    <div class="plan-box">
      <div class="plan-label">Was Enrolled In</div>
      <div class="plan-name">${a.previousPlanName||"Previously enrolled"}</div>
      <div class="plan-carrier">${a.previousCarrier}</div>
    </div>
    <div class="arrow">→</div>
    <div class="plan-box" style="border-color:#7f1d1d;">
      <div class="plan-label" style="color:#ef4444;">Current Status</div>
      <div class="plan-name" style="color:#f87171;">No Active MA Plan</div>
      <div class="plan-carrier">May have moved to Original Medicare, lost coverage, or disenrolled</div>
    </div>
  </div>
  <div class="details">
    <div class="detail-row"><span class="detail-label">Detected Via</span><span class="detail-value">${a.detectedVia}</span></div>
  </div>
  <a href="${a.alertUrl}" class="cta">View Alert &amp; Take Action</a>
  <p class="footer">AegisSage Medicare Retention Platform &middot; You are receiving this because a coverage gap was detected.</p>
</div></div></body></html>`):"carrier_switch"===a.switchType?(r=`${a.memberName} appears to have switched carriers`,n=`<!DOCTYPE html><html><head><style>${l}</style></head><body>
<div class="wrapper"><div class="card">
  <div class="logo">AegisSage</div>
  <span class="badge badge-red">Carrier Switch Detected</span>
  <h2>${a.memberName} moved to a different carrier</h2>
  <p class="subtitle">This client is no longer on ${a.previousCarrier}. They have switched to a different insurance carrier.</p>
  <div class="plan-row">
    <div class="plan-box">
      <div class="plan-label">Previous Carrier</div>
      <div class="plan-name">${a.previousPlanName||"Previous plan"}</div>
      <div class="plan-carrier">${a.previousCarrier}</div>
    </div>
    <div class="arrow">→</div>
    <div class="plan-box" style="border-color:#7f1d1d;">
      <div class="plan-label" style="color:#ef4444;">New Carrier</div>
      <div class="plan-name">${a.newPlanName||"New plan"}</div>
      <div class="plan-carrier">${a.newCarrier}</div>
    </div>
  </div>
  <div class="details">
    <div class="detail-row"><span class="detail-label">Detected Via</span><span class="detail-value">${a.detectedVia}</span></div>
  </div>
  <a href="${a.alertUrl}" class="cta">View Alert &amp; Take Action</a>
  <p class="footer">AegisSage Medicare Retention Platform &middot; You are receiving this because a carrier change was detected in MARx.</p>
</div></div></body></html>`):(r=`${a.memberName} may be switching plans`,n=`<!DOCTYPE html><html><head><style>${l}</style></head><body>
<div class="wrapper"><div class="card">
  <div class="logo">AegisSage</div>
  <span class="badge badge-orange">Plan Change Detected</span>
  <h2>${a.memberName} has a new plan</h2>
  <p class="subtitle">This client's Medicare Advantage plan has changed. They are still on Medicare Advantage.</p>
  <div class="plan-row">
    <div class="plan-box">
      <div class="plan-label">Previous Plan</div>
      <div class="plan-name">${a.previousPlanName||"Previous plan on file"}</div>
      <div class="plan-carrier">${a.previousCarrier}</div>
    </div>
    <div class="arrow">→</div>
    <div class="plan-box" style="border-color:#7c2d12;">
      <div class="plan-label" style="color:#fb923c;">New Plan</div>
      <div class="plan-name">${a.newPlanName||"New plan detected"}</div>
      <div class="plan-carrier">${a.newCarrier}</div>
    </div>
  </div>
  <div class="details">
    <div class="detail-row"><span class="detail-label">Detected Via</span><span class="detail-value">${a.detectedVia}</span></div>
  </div>
  <a href="${a.alertUrl}" class="cta">View Alert &amp; Take Action</a>
  <p class="footer">AegisSage Medicare Retention Platform &middot; You are receiving this because a plan change was detected in MARx.</p>
</div></div></body></html>`);try{await i().emails.send({from:t,to:e,subject:r,html:n})}catch(e){throw console.error("[sendSwitchAlertEmail]",e),e}}async function k(){if(!process.env.RESEND_API_KEY?.startsWith("re_"))return void console.error("[email] RESEND_API_KEY is not set — notifyOpenAlerts skipped");try{let e=(0,h.createServiceClient)(),{data:a}=await e.from("switch_alerts").select("id, agency_id, broker_id, bob_member_id, alert_type, switch_type, carrier, previous_plan_code, new_plan_code, previous_value, new_value").eq("status","open").is("notified_at",null);if(!a?.length)return;let r=[...new Set(a.map(e=>e.bob_member_id).filter(Boolean))],{data:n}=await e.from("book_of_business").select("id, full_name").in("id",r),l=new Map((n??[]).map(e=>[e.id,e.full_name??"Unknown"])),s=new Map;for(let e of a)e.broker_id&&(s.has(e.broker_id)||s.set(e.broker_id,[]),s.get(e.broker_id).push(e));let o=new Date().toISOString(),d=(await Promise.allSettled(Array.from(s.entries()).map(async([a,r])=>{let{data:n}=await e.from("brokers").select("first_name, last_name, email").eq("id",a).maybeSingle();if(!n?.email)return{brokerId:a,skipped:!0,reason:"no email"};let s=r.map(e=>{let a=l.get(e.bob_member_id??"")??"Unknown Client",t=e.previous_plan_code??e.previous_value??"Unknown",r=e.new_plan_code??e.new_value??"Unknown",i=e.carrier??"Unknown";return"termed"===e.alert_type||"termed"===e.switch_type?`- ${a} -- No longer on Medicare Advantage (was: ${i} ${t})`:"aor_change"===e.alert_type?`- ${a} -- AOR change detected (may have switched brokers) -- ${i}`:`- ${a} -- Plan switch: ${t} -> ${r} (${i})`}).join("\n"),d=r.length,c=`AegisSage -- ${d} client${d>1?"s":""} need${1===d?"s":""} attention`,p=`<p>Hi ${n.first_name},</p>
<p>AegisSage detected the following changes in your book of business:</p>
<pre style="font-family:monospace;background:#f4f4f4;padding:16px;border-radius:8px;white-space:pre-wrap">${s}</pre>
<p><a href="${y}/dashboard/alerts" style="background:#6366f1;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold">View All Alerts</a></p>
<p style="color:#888;font-size:12px">AegisSage Medicare Retention Platform</p>`,m=r.map(e=>e.id),f=!1,g=null;try{await (0,u.withRetry)(()=>i().emails.send({from:t,to:n.email,subject:c,html:p}),{maxAttempts:3,baseDelayMs:500,label:`notifyOpenAlerts broker=${a}`}),f=!0}catch(e){g=e instanceof Error?e.message:String(e),console.error(`[notifyOpenAlerts] email failed for broker ${a}:`,g)}f&&await (0,u.withRetrySafe)(async()=>{let a=await e.from("switch_alerts").update({notified_at:o,notification_email:n.email}).in("id",m);if(a.error)throw a.error},{maxAttempts:3,baseDelayMs:200,label:"notifyOpenAlerts stamp notified_at"});let b=m.map(e=>({alert_id:e,delivery_status:f?"sent":"failed",delivery_channel:"email",recipient_email:n.email,error_message:g,attempted_at:o}));return await (0,u.withRetrySafe)(async()=>{let a=await e.from("alert_delivery_log").insert(b);if(a.error)throw a.error},{maxAttempts:2,baseDelayMs:200,label:"notifyOpenAlerts delivery log"}),{brokerId:a,sent:f,alertCount:r.length,error:g}}))).filter(e=>"rejected"===e.status||"fulfilled"===e.status&&e.value&&!e.value.skipped&&!e.value.sent).length;d>0&&console.error(`[notifyOpenAlerts] ${d} broker(s) had delivery failures -- will retry next cron run`)}catch(e){console.error("[notifyOpenAlerts]",e)}}async function A(){try{let e=(0,h.createServiceClient)(),{data:a}=await e.from("agencies").select("id, name");if(!a?.length)return;for(let r of a){let{data:a}=await e.from("brokers").select("id, user_id, first_name, last_name, email, role").eq("agency_id",r.id).not("email","is",null);if(!a?.length)continue;let[{count:n},{count:b},{count:v},{count:h}]=await Promise.all([e.from("switch_alerts").select("id",{count:"exact",head:!0}).eq("agency_id",r.id).eq("status","open"),e.from("vcc_submissions").select("id",{count:"exact",head:!0}).eq("agency_id",r.id).eq("fax_status","scheduled"),e.from("aor_submissions").select("id",{count:"exact",head:!0}).eq("agency_id",r.id).eq("status","client_signed"),e.from("ghl_contacts").select("id",{count:"exact",head:!0}).eq("agency_id",r.id).in("risk_level",["critical","high"])]);await Promise.allSettled(a.map(async e=>{try{let{subject:a,html:w}=function(e){let a=`Your Medicare book update is ready — ${e.agencyName}`,t=(e,a,t=s)=>`<td style="text-align:center;padding:16px 20px;background:${l};border-radius:10px;border:1px solid ${d};">
      <div style="font-size:28px;font-weight:900;color:${t};">${a}</div>
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:${o};margin-top:4px;">${e}</div>
    </td>`;return{subject:a,html:c(a,`
    ${p("Weekly Digest")}
    <div style="margin-top:20px;">${m("Your Week in Review")}</div>
    ${f(`Hi ${e.brokerName}, here's your AegisSage summary for the week.`,!1)}
    <table width="100%" cellspacing="8" style="margin:20px 0 28px;border-collapse:separate;border-spacing:8px;">
      <tr>
        ${t("Open Alerts",e.openAlerts,e.openAlerts>0?"#f59e0b":s)}
        ${t("VCC Pending",e.vccPending,e.vccPending>0?"#6366f1":s)}
        ${t("AOR Pending",e.aorPending,e.aorPending>0?"#6366f1":s)}
        ${t("At Risk",e.clientsAtRisk,e.clientsAtRisk>0?"#ef4444":s)}
      </tr>
    </table>
    ${g("Open Dashboard",e.dashboardUrl)}
  `)}}({brokerName:`${e.first_name} ${e.last_name}`,agencyName:r.name,openAlerts:n??0,vccPending:b??0,aorPending:v??0,clientsAtRisk:h??0,dashboardUrl:`${y}/dashboard`});await (0,u.withRetry)(()=>i().emails.send({from:t,to:e.email,subject:a,html:w}),{maxAttempts:2,baseDelayMs:500,label:`sendWeeklyDigests broker=${e.id}`})}catch(a){console.error(`[sendWeeklyDigests] email failed for broker ${e.id}:`,a)}}))}}catch(e){console.error("[sendWeeklyDigests]",e)}}e.s(["notifyNewSwitchAlerts",0,w,"notifyOpenAlerts",0,k,"notifyVCCDeadlines",0,_,"sendSwitchAlertEmail",0,$,"sendTeamInviteEmail",0,x,"sendWeeklyDigests",0,A],656270)}];

//# sourceMappingURL=src_lib_email_send-notifications_ts_1luxypc._.js.map
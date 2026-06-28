/**
 * /dashboard/scripts — Shield Campaign Scripts Workspace (Pillar 3)
 *
 * Server component: authenticates user, enforces tenant isolation, fetches all
 * switch_alerts in 'mitigating' status enriched with member names, then hands
 * the data to the ScriptsWorkspace client component for interactive editing
 * and GHL delivery.
 *
 * Tenant rules (mirroring alerts/page.tsx):
 *   - Agency owners / admins: see all mitigating alerts for their agency
 *   - Solo brokers / non-staff: see only alerts linked to their own BOB members
 */

import { redirect } from 'next/navigation'
import { Suspense }  from 'react'
import { createClient }        from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { ShieldCheck, Sparkles } from 'lucide-react'
import { ScriptsWorkspace, type MitigatingAlert } from '@/components/scripts-workspace'

export default async function ScriptsPage() {

  // ── Auth ────────────────────────────────────────────────────────────────────
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // ── Tenant resolution ───────────────────────────────────────────────────────
  const [{ data: agency }, { data: brokerRow }] = await Promise.all([
    supabase.from('agencies').select('id').eq('owner_id', user.id).maybeSingle(),
    supabase.from('brokers').select('id, role, agency_id').eq('user_id', user.id).maybeSingle(),
  ])

  const isPrincipal = ['agency_owner', 'agency_admin'].includes(brokerRow?.role ?? '') || !!agency
  const isCS        = brokerRow?.role === 'customer_service'
  const isStaff     = isPrincipal || isCS
  const agencyId    = agency?.id ?? brokerRow?.agency_id
  if (!agencyId) redirect('/login')

  const svc = createServiceClient()

  // ── Fetch mitigating alerts ─────────────────────────────────────────────────
  let q = svc
    .from('switch_alerts')
    .select(`
      id, bob_member_id, ghl_contact_id,
      carrier, switch_type, status,
      previous_carrier, new_carrier,
      previous_value, new_value,
      detected_at
    `)
    .eq('agency_id', agencyId)
    .in('status', ['mitigating', 'contacted'])   // include 'contacted' so sent scripts remain visible
    .order('detected_at', { ascending: false })
    .limit(100)

  // Non-staff: restrict to own BOB member alerts
  if (!isStaff && brokerRow?.id) {
    const { data: myMemberIds } = await svc
      .from('book_of_business')
      .select('id')
      .eq('broker_id', brokerRow.id)
    const ids = (myMemberIds ?? []).map((m: { id: string }) => m.id).filter(Boolean)
    if (ids.length > 0) {
      q = q.in('bob_member_id', ids) as typeof q
    }
  }

  const { data: rawAlerts } = await q
  const alertList = rawAlerts ?? []

  // ── Enrich with member names ────────────────────────────────────────────────
  const bobIds = [...new Set(alertList.map(a => a.bob_member_id).filter(Boolean))] as string[]
  const { data: members } = bobIds.length > 0
    ? await svc
        .from('book_of_business')
        .select('id, full_name, plan_name, carrier, carrier_display_name')
        .in('id', bobIds)
    : { data: [] }

  const memberMap = new Map((members ?? []).map(m => [m.id, m]))

  const alerts: MitigatingAlert[] = alertList.map(a => ({
    id:               a.id,
    bob_member_id:    a.bob_member_id,
    ghl_contact_id:   a.ghl_contact_id,
    carrier:          a.carrier,
    switch_type:      a.switch_type,
    previous_carrier: (a as Record<string, unknown>).previous_carrier as string | null ?? null,
    new_carrier:      (a as Record<string, unknown>).new_carrier as string | null ?? null,
    previous_value:   a.previous_value,
    new_value:        a.new_value,
    detected_at:      a.detected_at,
    status:           a.status ?? 'mitigating',
    member_full_name: (a.bob_member_id && memberMap.get(a.bob_member_id)?.full_name) ?? null,
    member_plan:      (a.bob_member_id && memberMap.get(a.bob_member_id)?.plan_name) ?? a.previous_value ?? null,
  }))

  const pendingCount = alerts.filter(a => a.status === 'mitigating').length

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full w-full bg-slate-950">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="h-16 border-b border-slate-800 px-8 flex items-center justify-between bg-slate-950/80 backdrop-blur-md sticky top-0 z-10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
            <ShieldCheck className="w-4 h-4 text-violet-400" />
          </div>
          <div>
            <h1 className="text-lg font-black text-white uppercase tracking-tight">
              Shield Campaigns
            </h1>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              Pillar 3 · Maya AI Outreach
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {pendingCount > 0 ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-violet-500/10 border border-violet-500/20">
              <Sparkles className="w-3 h-3 text-violet-400" />
              <span className="text-[9px] font-black uppercase tracking-widest text-violet-400">
                {pendingCount} pending outreach
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <ShieldCheck className="w-3 h-3 text-emerald-400" />
              <span className="text-[9px] font-black uppercase tracking-widest text-emerald-400">
                All campaigns sent
              </span>
            </div>
          )}
        </div>
      </header>

      {/* ── Two-column workspace ─────────────────────────────────────────────── */}
      <Suspense
        fallback={
          <div className="flex-1 flex items-center justify-center">
            <div className="flex items-center gap-2 text-slate-600">
              <Sparkles className="w-4 h-4 animate-pulse" />
              <span className="text-[10px] font-black uppercase tracking-widest">Loading campaigns…</span>
            </div>
          </div>
        }
      >
        <ScriptsWorkspace initialAlerts={alerts} />
      </Suspense>
    </div>
  )
}

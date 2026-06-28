import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { Bell } from 'lucide-react'
import { AlertsFeed } from '@/components/alerts-feed'
import { getAlertTypology } from '@/components/alert-card'

export default async function AlertsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: agency }, { data: brokerRow }] = await Promise.all([
    supabase.from('agencies').select('id').eq('owner_id', user.id).maybeSingle(),
    supabase.from('brokers').select('id, role, agency_id').eq('user_id', user.id).maybeSingle(),
  ])

  const isPrincipal = ['agency_owner', 'agency_admin'].includes(brokerRow?.role ?? '')
  const isCS        = brokerRow?.role === 'customer_service'
  const isStaff     = isPrincipal || isCS || !!agency
  const agencyId    = agency?.id ?? brokerRow?.agency_id
  if (!agencyId) redirect('/login')

  const supabaseAdmin = createServiceClient()

  let alertsQuery = supabaseAdmin
    .from('switch_alerts')
    .select(`
      id, broker_id, bob_member_id, carrier, alert_type,
      previous_value, new_value, priority, status,
      detection_source, detected_at, created_at,
      confidence_score, confidence_status,
      switch_type, previous_plan_code, new_plan_code,
      new_plan_name, effective_date, end_date,
      previous_carrier, new_carrier, estimated_revenue_at_risk
    `)
    .eq('agency_id', agencyId)
    .order('detected_at', { ascending: false })
    .limit(200)

  // Non-staff brokers see only alerts for their own members
  if (!isStaff && brokerRow?.id) {
    const { data: myMemberIds } = await supabaseAdmin
      .from('book_of_business')
      .select('id')
      .eq('broker_id', brokerRow.id)
    const ids = (myMemberIds ?? []).map((m: any) => m.id).filter(Boolean)
    if (ids.length > 0) {
      alertsQuery = alertsQuery.in('bob_member_id', ids) as typeof alertsQuery
    }
  }

  const { data: alerts } = await alertsQuery
  const alertList = alerts ?? []

  // Batch-fetch member names from book_of_business
  const bobIds = [...new Set(alertList.map(a => a.bob_member_id).filter(Boolean))] as string[]
  const { data: members } = bobIds.length > 0
    ? await supabaseAdmin
        .from('book_of_business')
        .select('id, full_name, plan_name, carrier, carrier_display_name')
        .in('id', bobIds)
    : { data: [] }

  // Batch-fetch broker names for staff view
  const brokerIds = [...new Set(alertList.map(a => a.broker_id).filter(Boolean))] as string[]
  const { data: brokers } = isStaff && brokerIds.length > 0
    ? await supabaseAdmin
        .from('brokers')
        .select('id, full_name')
        .in('id', brokerIds)
    : { data: [] }

  const memberMap = new Map((members ?? []).map(m => [m.id, m]))
  const brokerMap = new Map((brokers ?? []).map(b => [b.id, b]))

  const enriched = alertList.map(a => ({
    ...a,
    member_full_name:  (a.bob_member_id && memberMap.get(a.bob_member_id)?.full_name) ?? null,
    member_plan:       (a.bob_member_id && memberMap.get(a.bob_member_id)?.plan_name) ?? a.previous_value ?? null,
    carrier_display:   (a.bob_member_id && (
                         memberMap.get(a.bob_member_id)?.carrier_display_name ||
                         (memberMap.get(a.bob_member_id)?.carrier !== 'unknown' ? memberMap.get(a.bob_member_id)?.carrier : null)
                       )) ?? a.carrier ?? null,
    broker_full_name:  (a.broker_id && brokerMap.get(a.broker_id)?.full_name) ?? null,
    switch_type:       a.switch_type ?? null,
    previous_plan_code: a.previous_plan_code ?? null,
    new_plan_code:     a.new_plan_code ?? null,
    new_plan_name:     a.new_plan_name ?? null,
    effective_date:    a.effective_date ?? null,
    end_date:          a.end_date ?? null,
    // Revenue tracking columns (added by migration 20260529100000)
    previous_carrier:           (a as Record<string, unknown>).previous_carrier as string | null ?? null,
    new_carrier:                (a as Record<string, unknown>).new_carrier as string | null ?? null,
    estimated_revenue_at_risk:  (a as Record<string, unknown>).estimated_revenue_at_risk as number | null ?? null,
  }))

  // Typology counts for header subtitle — no financial values
  const flightRiskCount = enriched.filter(a => getAlertTypology(a) === 'flight_risk').length
  const switchedCount   = enriched.filter(a => getAlertTypology(a) === 'switched').length

  const headerSubtitle = enriched.length === 0
    ? 'No active alerts'
    : [
        flightRiskCount > 0 && `${flightRiskCount} flight risk`,
        switchedCount   > 0 && `${switchedCount} switched`,
      ].filter(Boolean).join(' · ') || `${enriched.length} alerts`

  return (
    <div className="flex flex-col h-full w-full bg-background">
      <header className="h-16 border-b border-border px-8 flex items-center gap-3 bg-background/80 backdrop-blur-md sticky top-0 z-10">
        <div className="w-9 h-9 rounded-2xl bg-red-500/10 flex items-center justify-center">
          <Bell className="w-4 h-4 text-red-400" />
        </div>
        <div>
          <h1 className="text-lg font-black text-foreground uppercase tracking-tight">Alerts</h1>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
            {headerSubtitle} · {enriched.length} total
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6 pb-32">
        <AlertsFeed initialAlerts={enriched} agencyId={agencyId} isStaff={isStaff} />
      </div>
    </div>
  )
}

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { CollectionSidebar } from '@/components/collection-sidebar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from '@/components/ui/table'
import { Upload, AlertTriangle, CheckCircle2, TrendingDown } from 'lucide-react'
import { AlertActions } from './alert-actions'

type AlertType = 'missing_from_roster' | 'plan_change_detected' | 'new_enrollment' | 'status_change'
type Priority = 'critical' | 'high' | 'medium' | 'low'
type AlertStatus = 'open' | 'contacted' | 'resolved' | 'dismissed'

const ALERT_TYPE_CONFIG: Record<AlertType, { label: string; cls: string }> = {
  missing_from_roster:  { label: 'Switched',     cls: 'bg-red-500/10 text-red-600 border-red-500/20' },
  plan_change_detected: { label: 'Plan Change',  cls: 'bg-orange-500/10 text-orange-600 border-orange-500/20' },
  new_enrollment:       { label: 'New',           cls: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20' },
  status_change:        { label: 'Status Change', cls: 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20' },
}

const PRIORITY_CONFIG: Record<Priority, { label: string; cls: string }> = {
  critical: { label: 'Critical', cls: 'bg-red-500/20 text-red-600 border-red-500/30' },
  high:     { label: 'High',     cls: 'bg-orange-500/10 text-orange-600 border-orange-500/20' },
  medium:   { label: 'Medium',   cls: 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20' },
  low:      { label: 'Low',      cls: 'bg-muted text-muted-foreground border-border' },
}

function fmt(d: string | null | undefined) {
  if (!d) return '--'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default async function ChurnPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: agency }, { data: brokerRow }] = await Promise.all([
    supabase.from('agencies').select('id').eq('owner_id', user.id).maybeSingle(),
    supabase.from('brokers').select('id, role, agency_id').eq('user_id', user.id).maybeSingle(),
  ])
  const isPrincipal = !!agency || ['agency_admin', 'agency_owner'].includes(brokerRow?.role ?? '')
  const agencyId = agency?.id ?? brokerRow?.agency_id

  if (!agencyId) redirect('/login')

  // Build filtered alerts query — non-principals only see their own broker's alerts
  let alertsQuery = supabase
    .from('switch_alerts')
    .select('id, ghl_contact_id, carrier, alert_type, priority, status, new_value, previous_value, created_at, ghl_workflow_triggered, broker_id')
    .eq('agency_id', agencyId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (!isPrincipal && brokerRow?.id) {
    alertsQuery = alertsQuery.eq('broker_id', brokerRow.id)
  }

  const { data: alerts } = await alertsQuery
  const allAlerts = alerts ?? []

  // Fetch broker names for principal view
  let brokerMap: Record<string, string> = {}
  if (isPrincipal && allAlerts.length > 0) {
    const brokerIds = [...new Set(allAlerts.map(a => a.broker_id).filter(Boolean) as string[])]
    if (brokerIds.length > 0) {
      const { data: brokers } = await supabase
        .from('brokers')
        .select('id, first_name, last_name')
        .in('id', brokerIds)
      brokerMap = Object.fromEntries((brokers ?? []).map(b => [b.id, `${b.first_name} ${b.last_name}`]))
    }
  }

  const openAlerts = allAlerts.filter(a => a.status === 'open' || a.status === 'contacted')
  const criticalCount = openAlerts.filter(a => a.priority === 'critical').length
  const highCount = openAlerts.filter(a => a.priority === 'high').length

  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)
  const resolvedThisMonth = allAlerts.filter(
    a => a.status === 'resolved' && new Date(a.created_at) >= startOfMonth
  ).length

  return (
    <div className="flex h-full w-full bg-background">
      <CollectionSidebar />
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <header className="h-16 border-b border-border px-8 flex items-center justify-between bg-white/50 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-destructive/10 flex items-center justify-center text-destructive">
              <TrendingDown className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-black text-foreground uppercase tracking-tight">Ghost Churn Monitor</h1>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                {openAlerts.length} open alert{openAlerts.length !== 1 ? 's' : ''}
                {!isPrincipal && ' · my alerts'}
              </p>
            </div>
          </div>
          <Button asChild className="rounded-2xl font-black uppercase text-[10px] tracking-widest h-10 px-5 gap-2">
            <Link href="/dashboard/churn/upload">
              <Upload className="w-4 h-4" /> Upload Roster
            </Link>
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto p-8 max-w-6xl mx-auto w-full pb-32 space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total Open',          value: openAlerts.length,   icon: AlertTriangle, cls: 'text-destructive', bg: 'bg-destructive/5' },
              { label: 'Critical',             value: criticalCount,        icon: AlertTriangle, cls: 'text-red-600',     bg: 'bg-red-500/5' },
              { label: 'High Priority',        value: highCount,            icon: AlertTriangle, cls: 'text-orange-600',  bg: 'bg-orange-500/5' },
              { label: 'Resolved This Month',  value: resolvedThisMonth,    icon: CheckCircle2,  cls: 'text-emerald-600', bg: 'bg-emerald-500/5' },
            ].map(({ label, value, icon: Icon, cls, bg }) => (
              <Card key={label} className={`rounded-3xl border border-border shadow-sm ${bg}`}>
                <CardContent className="p-5 flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{label}</span>
                    <Icon className={`w-4 h-4 ${cls} opacity-50`} />
                  </div>
                  <div className={`text-3xl font-black tracking-tighter ${cls}`}>{value}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Alerts table */}
          {allAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-32 gap-4">
              <TrendingDown className="w-12 h-12 text-muted-foreground/30" />
              <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground/50">
                No alerts yet -- upload a carrier roster to start
              </p>
              <Button asChild variant="outline" className="rounded-2xl font-black uppercase text-[10px] tracking-widest">
                <Link href="/dashboard/churn/upload">Upload Roster</Link>
              </Button>
            </div>
          ) : (
            <Card className="rounded-3xl border border-border shadow-sm overflow-hidden">
              <CardHeader className="bg-muted/30 border-b">
                <CardTitle className="text-sm font-black uppercase tracking-tight flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-destructive" />
                  Switch Alerts
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent bg-transparent border-none">
                        {['Contact', 'Carrier', 'Type', 'Priority', ...(isPrincipal ? ['Broker'] : []), 'Status', 'Date', 'Actions'].map(h => (
                          <TableHead key={h} className="font-black uppercase text-[9px] tracking-widest text-muted-foreground py-4 px-4">
                            {h}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {allAlerts.map(a => {
                        const typeCfg = ALERT_TYPE_CONFIG[a.alert_type as AlertType] ?? { label: a.alert_type, cls: 'bg-muted text-muted-foreground border-border' }
                        const priCfg  = PRIORITY_CONFIG[a.priority as Priority] ?? PRIORITY_CONFIG.low
                        const isNew   = a.ghl_contact_id?.startsWith('new:')
                        const contactLabel = isNew ? (a.new_value ?? 'New Member') : a.ghl_contact_id

                        return (
                          <TableRow key={a.id} className="border-border/50 hover:bg-muted/20">
                            <TableCell className="px-4 py-3 font-bold text-xs max-w-[180px] truncate">{contactLabel}</TableCell>
                            <TableCell className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground px-4">{a.carrier}</TableCell>
                            <TableCell className="px-4">
                              <Badge className={`text-[8px] font-black uppercase px-2 border ${typeCfg.cls}`}>{typeCfg.label}</Badge>
                            </TableCell>
                            <TableCell className="px-4">
                              <Badge className={`text-[8px] font-black uppercase px-2 border ${priCfg.cls}`}>{priCfg.label}</Badge>
                            </TableCell>
                            {isPrincipal && (
                              <TableCell className="px-4 text-[10px] text-muted-foreground font-medium">
                                {a.broker_id ? (brokerMap[a.broker_id] ?? '—') : '—'}
                              </TableCell>
                            )}
                            <TableCell className="px-4 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{a.status}</TableCell>
                            <TableCell className="px-4 text-[10px] text-muted-foreground">{fmt(a.created_at)}</TableCell>
                            <TableCell className="px-4">
                              <AlertActions
                                alertId={a.id}
                                ghlContactId={a.ghl_contact_id}
                                status={a.status as AlertStatus}
                                ghlWorkflowTriggered={a.ghl_workflow_triggered ?? false}
                              />
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

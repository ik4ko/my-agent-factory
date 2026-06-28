import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { autoProvisionUser } from '@/app/actions/auto-provision'
import { OnboardingChecklist } from '@/components/onboarding-checklist'
import { RevenueLeakageCalculator } from '@/components/revenue-leakage-calculator'
import { AgencyInviteModal } from '@/components/dashboard/agency-invite-modal'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import {
  Users, TrendingDown, FileCheck, ShieldCheck,
  AlertTriangle, ArrowUpRight, XCircle, User,
  Building2, Eye, Megaphone, UploadCloud, Activity,
} from 'lucide-react'
import type { ElementType } from 'react'
import { hasPermission, type UserRole } from '@/lib/permissions'

// ── Role mapping: DB values → permissions.ts UserRole ───────────────────────
function dbRoleToUserRole(dbRole: string | null | undefined): UserRole {
  const map: Record<string, UserRole> = {
    agency_owner:    'AGENCY_OWNER',
    agency_admin:    'AGENCY_MANAGER',
    customer_service:'AGENCY_CUSTOMER_SERVICE',
    broker:          'BROKER',
    solo_broker:     'BROKER',
  }
  return map[dbRole ?? ''] ?? 'BROKER'
}

// ── Role badge colors ──────────────────────────────────────────────────────
function RoleBadge({ role }: { role: string }) {
  const cfg: Record<string, string> = {
    agency_owner:    'bg-primary/15 text-primary border-primary/30',
    agency_admin:    'bg-blue-500/15 text-blue-300 border-blue-500/30',
    customer_service:'bg-purple-500/15 text-purple-300 border-purple-500/30',
    broker:          'bg-white/5 text-white/50 border-white/10',
    solo_broker:     'bg-white/5 text-white/50 border-white/10',
  }
  const label: Record<string, string> = {
    agency_owner:    'Owner',
    agency_admin:    'Manager',
    customer_service:'CS',
    broker:          'Broker',
    solo_broker:     'Broker',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[9px] font-black uppercase tracking-widest ${cfg[role] ?? cfg.broker}`}>
      {label[role] ?? role}
    </span>
  )
}

function StatCard({
  label, value, sub, icon: Icon, href, accentCls = '',
}: {
  label: string
  value: string | number
  sub?: string
  icon: ElementType
  href?: string
  accentCls?: string
}) {
  const inner = (
    <Card className={`rounded-3xl border-none p-5 flex flex-col justify-between min-h-[140px] shadow-sm bg-muted/30 transition-colors ${href ? 'hover:bg-muted/50 cursor-pointer' : ''}`}>
      <div className="flex justify-between items-start">
        <span className={`text-[10px] font-black uppercase tracking-widest ${accentCls || 'text-muted-foreground'}`}>{label}</span>
        <Icon className={`w-4 h-4 opacity-50 ${accentCls || 'text-primary'}`} />
      </div>
      <div>
        <div className={`text-3xl font-black mb-1 tracking-tighter ${accentCls || ''}`}>{value}</div>
        {sub && <div className={`text-[9px] font-black uppercase tracking-widest ${accentCls ? accentCls + '/80' : 'text-muted-foreground'}`}>{sub}</div>}
      </div>
    </Card>
  )
  if (href) return <Link href={href} className="block">{inner}</Link>
  return inner
}

function formatRelative(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const h = Math.floor(diff / 3_600_000)
  if (h < 1) return 'Just now'
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: agency }, { data: brokerRow }] = await Promise.all([
    supabase.from('agencies').select('id, name, subscription_tier, included_seats').eq('owner_id', user.id).maybeSingle(),
    supabase.from('brokers').select('id, role, agency_id').eq('user_id', user.id).maybeSingle(),
  ])

  const userRole      = dbRoleToUserRole(brokerRow?.role)
  const isPrincipal   = ['agency_owner', 'agency_admin'].includes(brokerRow?.role ?? '')
  const isCS          = brokerRow?.role === 'customer_service'
  const isAgencyStaff = hasPermission(userRole, 'canViewAgencyDashboard') || !!agency
  const isStaff       = isPrincipal || isCS || !!agency

  const sp       = await searchParams
  const agencyId = brokerRow?.agency_id ?? agency?.id

  if (!agencyId) {
    try {
      await autoProvisionUser({ userId: user.id, email: user.email ?? '' })
    } catch (e) {
      console.error('[dashboard] auto-provision failed:', e)
      return (
        <div className="flex h-full w-full bg-background overflow-hidden">
          <div className="flex-1 flex flex-col p-8">
            <div className="rounded-3xl border border-amber-500/30 bg-amber-500/10 p-6 max-w-lg mt-8">
              <p className="text-sm font-black text-amber-300 uppercase tracking-widest">Account Setup In Progress</p>
              <p className="text-xs text-amber-200/70 mt-2 leading-relaxed font-medium">
                Your workspace is still being provisioned. Please refresh the page in a moment.
                If this persists, contact support at support@aegissage.com
              </p>
            </div>
          </div>
        </div>
      )
    }
    redirect('/dashboard')
  }

  // ── Resolve agency name ────────────────────────────────────────────────────
  let agencyName = agency?.name ?? null
  if (!agencyName && isStaff && brokerRow?.agency_id) {
    const { data: agData } = await supabase.from('agencies').select('name').eq('id', brokerRow.agency_id).maybeSingle()
    agencyName = agData?.name ?? null
  }

  const supabaseAdmin = createServiceClient()

  // ═══════════════════════════════════════════════════════════════════════════
  // AGENCY DASHBOARD — for principals, agency_admin, and customer_service
  // ═══════════════════════════════════════════════════════════════════════════
  if (isAgencyStaff && agencyId) {
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

    const [
      { data: agencyBrokers },
      { data: allClients },
      { data: openAlertRows },
      { count: campaignCountMTD },
      { count: activeBrokerCount },
      { data: recentAlertRows },
      { data: agencyDetails },
    ] = await Promise.all([
      supabaseAdmin
        .from('brokers')
        .select('id, first_name, last_name, email, role, is_active, created_at')
        .eq('agency_id', agencyId)
        .order('created_at', { ascending: true }),
      supabaseAdmin
        .from('book_of_business')
        .select('broker_id')
        .eq('agency_id', agencyId),
      supabaseAdmin
        .from('switch_alerts')
        .select('broker_id')
        .eq('agency_id', agencyId)
        .in('status', ['open', 'contacted']),
      supabaseAdmin
        .from('campaign_enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('agency_id', agencyId)
        .gte('created_at', monthStart),
      supabaseAdmin
        .from('brokers')
        .select('id', { count: 'exact', head: true })
        .eq('agency_id', agencyId)
        .eq('is_active', true),
      supabaseAdmin
        .from('switch_alerts')
        .select('id, switch_type, status, broker_id, created_at')
        .eq('agency_id', agencyId)
        .order('created_at', { ascending: false })
        .limit(20),
      supabaseAdmin
        .from('agencies')
        .select('included_seats, seat_limit')
        .eq('id', agencyId)
        .maybeSingle(),
    ])

    // Aggregate per-broker stats in JS (avoids N+1 queries)
    const clientsByBroker: Record<string, number> = {}
    for (const row of allClients ?? []) {
      if (row.broker_id) clientsByBroker[row.broker_id] = (clientsByBroker[row.broker_id] ?? 0) + 1
    }
    const alertsByBroker: Record<string, number> = {}
    for (const row of openAlertRows ?? []) {
      if (row.broker_id) alertsByBroker[row.broker_id] = (alertsByBroker[row.broker_id] ?? 0) + 1
    }

    const brokers      = agencyBrokers ?? []
    const totalClients = allClients?.length ?? 0
    const openAlerts   = openAlertRows?.length ?? 0
    const includedSeats= agencyDetails?.included_seats ?? (agency?.included_seats as number | undefined) ?? 5
    const activeSeats  = activeBrokerCount ?? 0
    const recentAlerts = recentAlertRows ?? []

    const switchTypeLabel: Record<string, string> = {
      future_plan_change: 'Upcoming plan switch',
      termed:             'Termed / disenrolled',
      fully_disenrolled:  'Fully disenrolled',
      plan_changed:       'Plan changed',
    }

    return (
      <div className="flex h-full w-full bg-background overflow-hidden">
        <div className="flex-1 flex flex-col h-full overflow-y-auto">

          {/* ── Section 1: Agency Command Header ───────────────────────────── */}
          <div className="bg-slate-900 border-b border-white/[0.07] px-6 py-5 md:px-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="space-y-2">
                <h1 className="text-xl md:text-2xl font-black tracking-tight text-white uppercase">
                  {agencyName ?? 'Agency Dashboard'}
                </h1>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="bg-primary/10 text-primary border-primary/20 font-black uppercase text-[9px] tracking-widest px-2 h-5">
                    Agency Plan
                  </Badge>
                  <Badge className="bg-white/5 text-white/60 border-white/10 font-black uppercase text-[9px] tracking-widest px-2 h-5">
                    {activeSeats} / {includedSeats} seats active
                  </Badge>
                  <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 px-2 h-5 gap-1.5 font-black uppercase tracking-widest text-[9px]">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Live
                  </Badge>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <AgencyInviteModal agencyId={agencyId} />
                <Button asChild size="sm" variant="outline" className="rounded-xl font-black uppercase text-[10px] tracking-widest h-9 gap-2 border-white/20 text-white hover:bg-white/10">
                  <Link href="/dashboard/campaigns">
                    <Megaphone className="w-3.5 h-3.5" />
                    New Campaign
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline" className="rounded-xl font-black uppercase text-[10px] tracking-widest h-9 gap-2 border-white/20 text-white hover:bg-white/10">
                  <Link href="/dashboard/churn/upload">
                    <UploadCloud className="w-3.5 h-3.5" />
                    Upload Roster
                  </Link>
                </Button>
              </div>
            </div>
          </div>

          <div className="flex-1 p-4 md:p-8 space-y-8 pb-24">

            {/* ── Section 2: Agency Stats Row ────────────────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                label="Total Clients"
                value={totalClients}
                sub="Across all brokers"
                icon={Users}
                href="/dashboard/book"
              />
              <StatCard
                label="Active Alerts"
                value={openAlerts}
                sub="Require action"
                icon={AlertTriangle}
                href="/dashboard/alerts"
                accentCls={openAlerts > 0 ? 'text-red-500' : ''}
              />
              <StatCard
                label="Campaigns (MTD)"
                value={campaignCountMTD ?? 0}
                sub="This month"
                icon={Megaphone}
                href="/dashboard/campaigns"
              />
              <StatCard
                label="Active Brokers"
                value={activeSeats}
                sub={`of ${includedSeats} included`}
                icon={Eye}
                href="/dashboard/team"
                accentCls={activeSeats > includedSeats ? 'text-amber-500' : ''}
              />
            </div>

            {/* ── Section 3: Broker Roster Table ─────────────────────────── */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  Team Roster — {brokers.length} member{brokers.length !== 1 ? 's' : ''}
                </h2>
                <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-[9px] font-black uppercase tracking-widest text-muted-foreground hover:text-primary">
                  <Link href="/dashboard/team"><ArrowUpRight className="w-3 h-3 mr-1" />Manage</Link>
                </Button>
              </div>

              {brokers.length === 0 ? (
                <div className="rounded-3xl border border-border bg-muted/10 p-8 text-center">
                  <Users className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-40" />
                  <p className="text-sm font-black uppercase tracking-widest text-muted-foreground">No team members yet</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Add a team member to get started</p>
                </div>
              ) : (
                <div className="rounded-3xl border border-border overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-muted/20">
                        {['Name', 'Role', 'Clients', 'Open Alerts', 'Actions'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {brokers.map((broker, i) => {
                        const clients = clientsByBroker[broker.id] ?? 0
                        const alerts  = alertsByBroker[broker.id] ?? 0
                        const isOwner = broker.role === 'agency_owner'
                        return (
                          <tr
                            key={broker.id}
                            className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${i === brokers.length - 1 ? 'border-b-0' : ''}`}
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-full bg-muted/50 flex items-center justify-center text-[10px] font-black text-muted-foreground shrink-0">
                                  {broker.first_name?.[0]}{broker.last_name?.[0]}
                                </div>
                                <div>
                                  <p className="text-sm font-bold text-foreground">{broker.first_name} {broker.last_name}</p>
                                  {broker.email && <p className="text-[10px] text-muted-foreground">{broker.email}</p>}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <RoleBadge role={broker.role} />
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-sm font-black tabular-nums">{clients}</span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-sm font-black tabular-nums ${alerts > 0 ? 'text-red-400' : 'text-muted-foreground'}`}>{alerts}</span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <Link
                                  href={`/dashboard/book?broker_id=${broker.id}`}
                                  className="text-[10px] font-black uppercase tracking-widest text-primary hover:text-primary/80 transition-colors"
                                >
                                  View Book
                                </Link>
                                {!isOwner && (
                                  <Link
                                    href={`/dashboard/team?remove=${broker.id}`}
                                    className="text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-red-400 transition-colors"
                                  >
                                    Remove
                                  </Link>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ── Section 4: Recent Activity Feed ───────────────────────── */}
            <div className="space-y-3">
              <h2 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                Recent Activity
              </h2>

              {recentAlerts.length === 0 ? (
                <div className="rounded-3xl border border-border bg-muted/10 p-8 text-center">
                  <Activity className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-40" />
                  <p className="text-sm font-black uppercase tracking-widest text-muted-foreground">No recent activity</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Upload a roster to start monitoring plan switches</p>
                </div>
              ) : (
                <div className="rounded-3xl border border-border overflow-hidden divide-y divide-border/50">
                  {recentAlerts.map(alert => {
                    const broker = brokers.find(b => b.id === alert.broker_id)
                    const isOpen = alert.status === 'open' || alert.status === 'contacted'
                    return (
                      <div key={alert.id} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/10 transition-colors">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isOpen ? 'bg-red-500/10' : 'bg-muted/30'}`}>
                          {isOpen
                            ? <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                            : <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-foreground truncate">
                            {switchTypeLabel[alert.switch_type] ?? alert.switch_type ?? 'Alert'}
                          </p>
                          {broker && (
                            <p className="text-[10px] text-muted-foreground">
                              {broker.first_name} {broker.last_name}
                            </p>
                          )}
                        </div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground shrink-0">
                          {alert.created_at ? formatRelative(alert.created_at) : '—'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BROKER DASHBOARD — unchanged from original
  // ═══════════════════════════════════════════════════════════════════════════

  const brokerId = brokerRow?.id ?? ''
  const [
    { count: myClients },
    { count: myAlerts },
    { count: myVcc },
    { count: resolvedAlerts },
    { count: totalAlerts },
  ] = await Promise.all([
    supabaseAdmin.from('book_of_business').select('id', { count: 'exact', head: true }).eq('agency_id', agencyId).eq('broker_id', brokerId),
    supabaseAdmin.from('switch_alerts').select('id', { count: 'exact', head: true }).eq('agency_id', agencyId).eq('broker_id', brokerId).in('status', ['open', 'contacted']),
    supabaseAdmin.from('vcc_submissions').select('id', { count: 'exact', head: true }).eq('agency_id', agencyId).eq('broker_id', brokerId).not('fax_status', 'in', '("signed","expired")'),
    supabaseAdmin.from('switch_alerts').select('id', { count: 'exact', head: true }).eq('agency_id', agencyId).eq('broker_id', brokerId).eq('status', 'resolved'),
    supabaseAdmin.from('switch_alerts').select('id', { count: 'exact', head: true }).eq('agency_id', agencyId).eq('broker_id', brokerId),
  ])

  const total = totalAlerts ?? 0
  const brokerStats = {
    myClients:    myClients ?? 0,
    myOpenAlerts: myAlerts ?? 0,
    myVccPending: myVcc ?? 0,
    mySaveRate:   total > 0 ? Math.round(((resolvedAlerts ?? 0) / total) * 100) : 100,
  }

  return (
    <div className="flex h-full w-full bg-background overflow-hidden">
      <div className="flex-1 flex flex-col h-full overflow-y-auto">
        <div className="flex-1 p-4 md:p-8 space-y-8 pb-24">

          {/* Header */}
          <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-xl md:text-3xl font-black tracking-tight text-foreground uppercase">
                MY DASHBOARD
              </h1>
              <p className="text-muted-foreground font-black text-[10px] uppercase tracking-widest">
                Your Book of Business
              </p>
            </div>
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 px-3 py-1 h-8 gap-2 font-black uppercase tracking-widest text-[9px]">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live
            </Badge>
          </div>

          {/* Stat Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="My Clients" value={brokerStats.myClients} sub="Assigned to you" icon={Users} href="/dashboard/book" />
            <StatCard label="My Open Alerts" value={brokerStats.myOpenAlerts} sub="Action required" icon={AlertTriangle} href="/dashboard/churn" accentCls={brokerStats.myOpenAlerts > 0 ? 'text-red-500' : ''} />
            <StatCard label="My VCC Pending" value={brokerStats.myVccPending} sub="Awaiting dispatch" icon={FileCheck} href="/dashboard/vcc" accentCls={brokerStats.myVccPending > 0 ? 'text-amber-500' : ''} />
            <StatCard label="My Save Rate" value={`${brokerStats.mySaveRate}%`} sub="Alerts resolved" icon={ShieldCheck} accentCls={brokerStats.mySaveRate >= 70 ? 'text-emerald-500' : 'text-amber-500'} />
          </div>

          {/* Onboarding */}
          <OnboardingChecklist />

          {/* Quick Actions */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Link href="/dashboard/book" className="group">
              <div className="flex items-center gap-4 p-5 rounded-3xl border border-border hover:border-primary/30 bg-muted/20 hover:bg-muted/30 transition-all">
                <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary"><Users className="w-5 h-5" /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-black uppercase tracking-widest">My Book</p>
                  <p className="text-[10px] text-muted-foreground font-medium">View all members</p>
                </div>
                <ArrowUpRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
            </Link>
            <Link href="/dashboard/churn/upload" className="group">
              <div className="flex items-center gap-4 p-5 rounded-3xl border border-border hover:border-primary/30 bg-muted/20 hover:bg-muted/30 transition-all">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-600"><TrendingDown className="w-5 h-5" /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-black uppercase tracking-widest">Upload Roster</p>
                  <p className="text-[10px] text-muted-foreground font-medium">Detect plan switches</p>
                </div>
                <ArrowUpRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
            </Link>
            <Link href="/dashboard/alerts" className="group">
              <div className="flex items-center gap-4 p-5 rounded-3xl border border-border hover:border-primary/30 bg-muted/20 hover:bg-muted/30 transition-all">
                <div className="w-10 h-10 rounded-2xl bg-red-500/10 flex items-center justify-center text-red-500"><AlertTriangle className="w-5 h-5" /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-black uppercase tracking-widest">View Alerts</p>
                  <p className="text-[10px] text-muted-foreground font-medium">Plan switches &amp; AOR changes</p>
                </div>
                <ArrowUpRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
            </Link>
          </div>

        </div>
      </div>
    </div>
  )
}

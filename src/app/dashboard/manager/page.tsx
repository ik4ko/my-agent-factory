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
import {
  DollarSign, FileText, BarChart3, AlertTriangle,
  Clock, Shield, ArrowLeft, Users, Bell, CheckCircle2,
  Database, Activity, Key, Lock, XCircle,
} from 'lucide-react'
import { createServiceClient } from '@/lib/supabase/service'

type FaxStatus = 'pending' | 'sent' | 'failed' | 'signed' | 'expired' | 'no_fax'

const FAX_CONFIG: Record<FaxStatus, { label: string; cls: string }> = {
  pending: { label: 'Pending',  cls: 'bg-gray-500/10 text-gray-500 border-gray-500/20' },
  sent:    { label: 'Faxed',    cls: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
  signed:  { label: 'Signed',   cls: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20' },
  failed:  { label: 'Failed',   cls: 'bg-red-500/10 text-red-600 border-red-500/20' },
  expired: { label: 'Expired',  cls: 'bg-red-500/10 text-red-600 border-red-500/20' },
  no_fax:  { label: 'No Fax',   cls: 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20' },
}

function fmt(d: string | null | undefined) {
  if (!d) return '--'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

function daysLeft(d: string) {
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000)
}

/** Human-readable relative timestamp for the compliance ledger. */
function relativeTime(d: string | null | undefined): string {
  if (!d) return '—'
  const ms   = Date.now() - new Date(d).getTime()
  const mins = Math.floor(ms / 60_000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins} min${mins !== 1 ? 's' : ''} ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs} hour${hrs !== 1 ? 's' : ''} ago`
  if (hrs < 48) {
    const t = new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    return `Yesterday at ${t}`
  }
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

const AVG_COMMISSION = 600

// ── Compliance event display configuration ────────────────────────────────────

type EventType =
  | 'CRM_EXPORT_STARTED' | 'CRM_EXPORT_COMPLETED' | 'CRM_EXPORT_FAILED'
  | 'CRM_IMPORT_STARTED' | 'CRM_IMPORT_COMPLETED'
  | 'PHI_ACCESS' | 'MBI_REVEAL' | 'MBI_COPY'
  | 'ROSTER_UPLOAD' | 'ROSTER_UPLOAD_ERRORS'
  | 'MEMBER_DELETE' | 'ALERT_ACKNOWLEDGE'
  | 'API_KEY_GENERATED' | 'LOGIN' | 'LOGIN_FAILED'

interface EventCfg {
  icon: React.ElementType
  label: string
  dot: string
}

const EVENT_CONFIG: Record<EventType, EventCfg> = {
  CRM_IMPORT_STARTED:   { icon: Database,      label: 'GHL Sync Started',    dot: 'bg-blue-400'    },
  CRM_IMPORT_COMPLETED: { icon: CheckCircle2,  label: 'GHL Sync Complete',   dot: 'bg-emerald-400' },
  CRM_EXPORT_STARTED:   { icon: Database,      label: 'BOB→GHL Push Started',dot: 'bg-indigo-400'  },
  CRM_EXPORT_COMPLETED: { icon: CheckCircle2,  label: 'BOB→GHL Push Done',   dot: 'bg-indigo-400'  },
  CRM_EXPORT_FAILED:    { icon: AlertTriangle, label: 'Push Failed',          dot: 'bg-red-400'     },
  PHI_ACCESS:           { icon: Shield,        label: 'AI Script Generated',  dot: 'bg-violet-400'  },
  MBI_REVEAL:           { icon: Shield,        label: 'MBI Accessed',         dot: 'bg-amber-400'   },
  MBI_COPY:             { icon: Shield,        label: 'MBI Copied',           dot: 'bg-amber-400'   },
  ROSTER_UPLOAD:        { icon: FileText,      label: 'Roster Uploaded',      dot: 'bg-blue-400'    },
  ROSTER_UPLOAD_ERRORS: { icon: AlertTriangle, label: 'Upload Errors',        dot: 'bg-red-400'     },
  MEMBER_DELETE:        { icon: XCircle,       label: 'Member Removed',       dot: 'bg-red-400'     },
  ALERT_ACKNOWLEDGE:    { icon: Bell,          label: 'Alert Acknowledged',   dot: 'bg-emerald-400' },
  API_KEY_GENERATED:    { icon: Key,           label: 'API Key Generated',    dot: 'bg-slate-400'   },
  LOGIN:                { icon: Lock,          label: 'Login',                dot: 'bg-slate-400'   },
  LOGIN_FAILED:         { icon: AlertTriangle, label: 'Login Failed',         dot: 'bg-red-400'     },
}

const DEFAULT_EVENT_CFG: EventCfg = { icon: Activity, label: 'System Event', dot: 'bg-slate-400' }

function groupCount(rows: Array<Record<string, unknown>>, key: string): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const val = row[key] as string | null
    if (val) acc[val] = (acc[val] ?? 0) + 1
    return acc
  }, {})
}

// ── Broker-isolated drilldown view ────────────────────────────────────────────

async function BrokerIsolatedView({
  brokerId,
  agencyId,
}: {
  brokerId: string
  agencyId: string
}) {
  const svc = createServiceClient()

  const { data: brokerRow } = await svc
    .from('brokers')
    .select('id, first_name, last_name, email, role, npn, created_at')
    .eq('id', brokerId)
    .eq('agency_id', agencyId)
    .maybeSingle()

  // Strict agency isolation: broker must belong to caller's agency
  if (!brokerRow) {
    redirect('/dashboard/team')
  }

  const brokerName = `${brokerRow.first_name} ${brokerRow.last_name}`

  const [
    { data: members },
    { data: alerts },
    { data: vccRows },
    { data: aorRows },
  ] = await Promise.all([
    svc.from('book_of_business')
      .select('id, full_name, carrier, plan_name, enrollment_status, updated_at')
      .eq('broker_id', brokerId)
      .eq('agency_id', agencyId)
      .order('updated_at', { ascending: false })
      .limit(25),
    svc.from('switch_alerts')
      .select('id, alert_type, status, priority, detected_at, bob_member_id')
      .eq('broker_id', brokerId)
      .eq('agency_id', agencyId)
      .in('status', ['open', 'contacted'])
      .order('detected_at', { ascending: false })
      .limit(15),
    svc.from('vcc_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('broker_id', brokerId)
      .eq('agency_id', agencyId),
    svc.from('aor_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('broker_id', brokerId)
      .eq('agency_id', agencyId)
      .in('status', ['faxed', 'confirmed']),
  ])

  const memberList    = members ?? []
  const alertList     = alerts  ?? []
  const vccCount      = (vccRows as any)?.count ?? 0
  const aorCount      = (aorRows as any)?.count ?? 0
  const openAlerts    = alertList.length
  const totalMembers  = memberList.length  // approximate from limit-25 fetch

  return (
    <div className="flex h-full w-full bg-background">
      <CollectionSidebar />
      <div className="flex-1 flex flex-col h-full overflow-hidden">

        <header className="h-16 border-b border-border px-8 flex items-center gap-4 bg-white/50 backdrop-blur-md sticky top-0 z-10">
          <Link href="/dashboard/team">
            <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground -ml-2">
              <ArrowLeft className="w-4 h-4" />
              <span className="text-[10px] font-black uppercase tracking-widest">Team</span>
            </Button>
          </Link>
          <div className="w-px h-5 bg-border" />
          <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-black text-foreground uppercase tracking-tight">{brokerName}</h1>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              Isolated Book View · {brokerRow.role.replace(/_/g, ' ')}
            </p>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 max-w-5xl mx-auto w-full pb-32 space-y-8">

          {/* Stats row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Members',      value: totalMembers >= 25 ? '25+' : String(totalMembers), icon: Users,         color: 'text-primary',      bg: 'bg-primary/10' },
              { label: 'Open Alerts',  value: String(openAlerts),  icon: Bell,          color: 'text-red-500',  bg: 'bg-red-500/10' },
              { label: 'VCC Filings',  value: String(vccCount),    icon: FileText,      color: 'text-blue-500', bg: 'bg-blue-500/10' },
              { label: 'AORs Locked',  value: String(aorCount),    icon: Shield,        color: 'text-emerald-600', bg: 'bg-emerald-500/10' },
            ].map(({ label, value, icon: Icon, color, bg }) => (
              <Card key={label} className="rounded-2xl border border-border shadow-sm">
                <CardContent className="p-5 flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${bg}`}>
                    <Icon className={`w-5 h-5 ${color}`} />
                  </div>
                  <div>
                    <p className="text-2xl font-black text-foreground">{value}</p>
                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{label}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Open alerts */}
          <Card className="rounded-3xl border border-border shadow-sm overflow-hidden">
            <CardHeader className="bg-muted/30 border-b py-4">
              <CardTitle className="text-sm font-black uppercase tracking-tight flex items-center gap-2">
                <Bell className="w-4 h-4 text-red-400" />
                Open Alerts
                {openAlerts > 0 && (
                  <Badge className="bg-red-500/10 text-red-500 border-red-500/20 text-[9px] font-black ml-1">{openAlerts}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {alertList.length === 0 ? (
                <div className="py-12 text-center flex flex-col items-center gap-2">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500/40" />
                  <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground/50">No open alerts</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent bg-transparent border-none">
                      {['Type', 'Priority', 'Detected', 'Status'].map(h => (
                        <TableHead key={h} className="font-black uppercase text-[9px] tracking-widest text-muted-foreground py-4 px-4">{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {alertList.map(a => (
                      <TableRow key={a.id} className="border-border/50 hover:bg-muted/20">
                        <TableCell className="px-4 py-3 font-bold text-sm capitalize">
                          {(a.alert_type ?? '—').replace(/_/g, ' ')}
                        </TableCell>
                        <TableCell className="px-4">
                          <Badge className={`text-[8px] font-black uppercase px-2 border ${
                            a.priority === 'critical' ? 'bg-red-500/10 text-red-500 border-red-500/20'
                            : a.priority === 'high' ? 'bg-orange-500/10 text-orange-500 border-orange-500/20'
                            : 'bg-slate-500/10 text-slate-500 border-slate-500/20'
                          }`}>{a.priority ?? '—'}</Badge>
                        </TableCell>
                        <TableCell className="px-4 text-[10px] text-muted-foreground">{fmt(a.detected_at)}</TableCell>
                        <TableCell className="px-4 text-[10px] text-muted-foreground capitalize">{a.status}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Member list */}
          <Card className="rounded-3xl border border-border shadow-sm overflow-hidden">
            <CardHeader className="bg-muted/30 border-b py-4">
              <CardTitle className="text-sm font-black uppercase tracking-tight flex items-center gap-2">
                <Users className="w-4 h-4" />
                Book of Business
                <span className="text-[9px] font-bold text-muted-foreground normal-case">most recent 25</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              {memberList.length === 0 ? (
                <div className="py-12 text-center text-[11px] font-black uppercase tracking-widest text-muted-foreground/50">
                  No members in this broker's book
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent bg-transparent border-none">
                      {['Member', 'Carrier', 'Plan', 'Status', 'Last Updated'].map(h => (
                        <TableHead key={h} className="font-black uppercase text-[9px] tracking-widest text-muted-foreground py-4 px-4">{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {memberList.map(m => (
                      <TableRow key={m.id} className="border-border/50 hover:bg-muted/20">
                        <TableCell className="px-4 py-3 font-bold text-sm">{m.full_name ?? '—'}</TableCell>
                        <TableCell className="px-4 text-[10px] font-bold uppercase text-muted-foreground">{m.carrier ?? '—'}</TableCell>
                        <TableCell className="px-4 text-[10px] text-muted-foreground max-w-[160px] truncate">{m.plan_name ?? '—'}</TableCell>
                        <TableCell className="px-4 text-[10px] capitalize text-muted-foreground">{m.enrollment_status ?? '—'}</TableCell>
                        <TableCell className="px-4 text-[10px] text-muted-foreground">{fmt(m.updated_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Broker profile metadata */}
          <div className="rounded-2xl border border-border p-5 space-y-2 bg-muted/20">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-3">Broker Profile</p>
            {[
              { label: 'Email',   value: brokerRow.email ?? '—' },
              { label: 'NPN',     value: brokerRow.npn ?? '—' },
              { label: 'Joined',  value: fmt(brokerRow.created_at) },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between text-sm">
                <span className="text-muted-foreground font-medium">{label}</span>
                <span className="font-bold text-foreground">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Agency overview (owner/staff view) ───────────────────────────────────────

export default async function ManagerPage({
  searchParams,
}: {
  searchParams: Promise<{ brokerId?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // ── Tier constants ─────────────────────────────────────────────────────────
  const BROKER_TIERS = ['broker', 'solo', 'starter']

  // ── Auth + tier resolution ─────────────────────────────────────────────────
  // Fetch subscription_tier so the gate can block broker-tier users who have
  // role='agency_owner' (assigned by auto-provision to all self-registered users).
  const [{ data: agency }, { data: brokerRow }] = await Promise.all([
    supabase.from('agencies').select('id, subscription_tier').eq('owner_id', user.id).maybeSingle(),
    supabase.from('brokers').select('role, agency_id').eq('user_id', user.id).maybeSingle(),
  ])

  const isOwner    = !!agency
  const agencyTier = agency?.subscription_tier ?? 'broker'

  // ── Gate 1: broker-tier owners ────────────────────────────────────────────
  // Self-provisioned solo brokers have role='agency_owner' — the role check
  // alone is insufficient. Tier is the authoritative signal.
  if (isOwner && BROKER_TIERS.includes(agencyTier)) {
    redirect('/dashboard/alerts')
  }

  // ── Gate 2: role check (non-owners) ───────────────────────────────────────
  const staffRoles = ['agency_owner', 'agency_admin', 'customer_service']
  const isStaff    = staffRoles.includes(brokerRow?.role ?? '') || isOwner
  if (!isStaff) redirect('/dashboard/alerts')

  // ── Gate 3: non-owner staff tier check ────────────────────────────────────
  if (!isOwner && brokerRow?.agency_id) {
    const { data: parentAgency } = await supabase
      .from('agencies')
      .select('subscription_tier')
      .eq('id', brokerRow.agency_id)
      .maybeSingle()
    if (BROKER_TIERS.includes(parentAgency?.subscription_tier ?? 'broker')) {
      redirect('/dashboard/alerts')
    }
  }

  const agencyId = agency?.id ?? brokerRow?.agency_id
  if (!agencyId) redirect('/dashboard/alerts')

  // Resolve brokerId param — strict agency-membership enforced inside BrokerIsolatedView
  const { brokerId } = await searchParams
  if (brokerId) {
    return <BrokerIsolatedView brokerId={brokerId} agencyId={agencyId} />
  }

  // ── Data fetch — try/catch so unexpected DB errors return an empty state
  //   rather than a Next.js crash page. All variable declarations live inside
  //   the try block so they are in scope for the JSX return below.
  try {

  // -- Section A: Revenue at Risk ------------------------------------------
  const { count: openSwitchCount } = await supabase
    .from('switch_alerts')
    .select('id', { count: 'exact', head: true })
    .eq('agency_id', agencyId)
    .eq('status', 'open')
    .eq('alert_type', 'missing_from_roster')

  const revenueAtRisk = (openSwitchCount ?? 0) * AVG_COMMISSION

  // -- Section B: Fax Audit Trail ------------------------------------------
  const { data: submissions } = await supabase
    .from('vcc_submissions')
    .select('id, client_name, carrier, fax_status, fax_sent_at, fax_confirmation_id, deadline_at, filled_pdf_path, broker:broker_id (first_name, last_name)')
    .eq('agency_id', agencyId)
    .order('deadline_at', { ascending: true })

  const allSubmissions = submissions ?? []

  // -- Section C: Broker Performance ---------------------------------------
  const { data: brokers } = await supabase
    .from('brokers')
    .select('id, first_name, last_name, role')
    .eq('agency_id', agencyId)
    .order('last_name')

  const allBrokers = brokers ?? []

  const supabaseAdmin = createServiceClient()

  const [clientCounts, openAlertCounts, totalAlertCounts, resolvedAlertCounts, VCCCounts, campaignCounts, aorLockedCounts, protectionStats] =
    await Promise.all([
      supabaseAdmin.from('book_of_business').select('broker_id').eq('agency_id', agencyId).then(r =>
        groupCount(r.data ?? [], 'broker_id')
      ),
      supabaseAdmin.from('switch_alerts').select('broker_id').eq('agency_id', agencyId).in('status', ['open', 'contacted']).then(r =>
        groupCount(r.data ?? [], 'broker_id')
      ),
      supabaseAdmin.from('switch_alerts').select('broker_id').eq('agency_id', agencyId).then(r =>
        groupCount(r.data ?? [], 'broker_id')
      ),
      supabaseAdmin.from('switch_alerts').select('broker_id').eq('agency_id', agencyId).eq('status', 'resolved').then(r =>
        groupCount(r.data ?? [], 'broker_id')
      ),
      supabaseAdmin.from('vcc_submissions').select('broker_id').eq('agency_id', agencyId).then(r =>
        groupCount(r.data ?? [], 'broker_id')
      ),
      supabaseAdmin.from('campaign_enrollments').select('broker_id').eq('agency_id', agencyId).eq('status', 'active').then(r =>
        groupCount(r.data ?? [], 'broker_id')
      ),
      supabaseAdmin.from('aor_submissions').select('broker_id').eq('agency_id', agencyId).in('status', ['faxed', 'confirmed']).then(r =>
        groupCount(r.data ?? [], 'broker_id')
      ),
      supabaseAdmin.from('agency_protection_stats')
        .select('total_contacts, locked_contacts, protection_rate')
        .eq('agency_id', agencyId)
        .maybeSingle()
        .then(r => r.data ?? null),
    ])

  const protectionRate  = Number(protectionStats?.protection_rate ?? 0)
  const totalProtected  = Number(protectionStats?.total_contacts ?? 0)
  const lockedProtected = Number(protectionStats?.locked_contacts ?? 0)
  const rateColor = protectionRate >= 70 ? 'text-emerald-600' : protectionRate >= 30 ? 'text-amber-500' : 'text-red-500'

  const brokerStats = allBrokers
    .map(b => {
      const total    = totalAlertCounts[b.id] ?? 0
      const resolved = resolvedAlertCounts[b.id] ?? 0
      const saveRate = total > 0 ? Math.round((resolved / total) * 100) : null
      return {
        id: b.id,
        name: `${b.first_name} ${b.last_name}`,
        role: b.role,
        clients: clientCounts[b.id] ?? 0,
        openAlerts: openAlertCounts[b.id] ?? 0,
        VCC: VCCCounts[b.id] ?? 0,
        activeCampaigns: campaignCounts[b.id] ?? 0,
        aorLocked: aorLockedCounts[b.id] ?? 0,
        saveRate,
      }
    })
    .sort((a, b) => {
      if (a.saveRate === null && b.saveRate === null) return 0
      if (a.saveRate === null) return 1
      if (b.saveRate === null) return -1
      return a.saveRate - b.saveRate
    })

  // ── Compliance ledger data ────────────────────────────────────────────────
  const [
    { count: totalBobCount },
    { count: mitigatingCount },
    { data: rawComplianceLogs },
  ] = await Promise.all([
    supabaseAdmin
      .from('book_of_business')
      .select('id', { count: 'exact', head: true })
      .eq('agency_id', agencyId),
    supabaseAdmin
      .from('switch_alerts')
      .select('id', { count: 'exact', head: true })
      .eq('agency_id', agencyId)
      .eq('status', 'mitigating'),
    supabaseAdmin
      .from('compliance_audit_logs')
      .select('id, event_type, description, status, ip_address, created_at, broker_user_id')
      .eq('agency_id', agencyId)
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  const complianceLogs = rawComplianceLogs ?? []

  // Enrich log rows with broker names (join via brokers.user_id)
  const logBrokerUserIds = [
    ...new Set(complianceLogs.map(l => l.broker_user_id).filter(Boolean))
  ] as string[]
  const { data: logBrokers } = logBrokerUserIds.length > 0
    ? await supabaseAdmin
        .from('brokers')
        .select('user_id, first_name, last_name')
        .in('user_id', logBrokerUserIds)
    : { data: [] }
  const brokerUserMap = new Map(
    (logBrokers ?? []).map(b => [
      b.user_id,
      `${b.first_name ?? ''} ${b.last_name ?? ''}`.trim() || 'System',
    ])
  )

  return (
    <div className="flex h-full w-full bg-background">
      <CollectionSidebar />
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <header className="h-16 border-b border-border px-8 flex items-center gap-4 bg-white/50 backdrop-blur-md sticky top-0 z-10">
          <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-black text-foreground uppercase tracking-tight">Agency Manager</h1>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              Revenue · Compliance · Performance
            </p>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 max-w-6xl mx-auto w-full pb-32 space-y-8">

          {/* ── Compliance metric snaps ───────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Total Synchronized Members */}
            <div className="rounded-2xl border border-border bg-card p-5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Users className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-black text-foreground tabular-nums">
                  {(totalBobCount ?? 0).toLocaleString()}
                </p>
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground truncate">
                  Total Synchronized Members
                </p>
              </div>
            </div>

            {/* Active Mitigations */}
            <div className="rounded-2xl border border-border bg-card p-5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center shrink-0">
                <Shield className="w-5 h-5 text-violet-500" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-black text-violet-500 tabular-nums">
                  {(mitigatingCount ?? 0).toLocaleString()}
                </p>
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground truncate">
                  Active Mitigations
                </p>
              </div>
            </div>

            {/* Audit Health Status */}
            <div className="rounded-2xl border border-border bg-card p-5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
                <Activity className="w-5 h-5 text-emerald-500" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                  <p className="text-sm font-black text-emerald-500 uppercase tracking-tight">
                    CMS Log Active
                  </p>
                </div>
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mt-0.5 truncate">
                  Audit Health Status · {complianceLogs.length > 0 ? `${complianceLogs.length} events on record` : 'No events yet'}
                </p>
              </div>
            </div>
          </div>

          {/* -- Agency Protection Rate ------------------------------------ */}
          <Card className="rounded-3xl border border-emerald-200 bg-emerald-500/5 shadow-sm">
            <CardContent className="p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
              <div className="flex items-center gap-5">
                <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
                  <Shield className="w-7 h-7 text-emerald-600" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500 mb-1">Agency Protection Rate</p>
                  <p className={`text-5xl font-black tracking-tighter ${rateColor}`}>
                    {protectionRate}%
                  </p>
                  <p className="text-sm font-bold text-muted-foreground mt-1">
                    {lockedProtected} of {totalProtected} clients have AORs on file
                  </p>
                </div>
              </div>
              <Link href="/dashboard/aor" className="shrink-0">
                <Button variant="outline" className="rounded-2xl font-black uppercase text-[10px] tracking-widest border-emerald-200 text-emerald-700 hover:bg-emerald-50 gap-2">
                  <Shield className="w-4 h-4" /> Manage AORs
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* -- Section A: Revenue at Risk -------------------------------- */}
          <Card className="rounded-3xl border border-red-200 bg-red-500/5 shadow-sm">
            <CardContent className="p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
              <div className="flex items-center gap-5">
                <div className="w-14 h-14 rounded-2xl bg-red-500/10 flex items-center justify-center">
                  <DollarSign className="w-7 h-7 text-red-600" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-red-400 mb-1">Revenue at Risk</p>
                  <p className="text-5xl font-black text-red-600 tracking-tighter">
                    ${revenueAtRisk.toLocaleString()}
                  </p>
                  <p className="text-[11px] font-bold text-red-400 mt-1">
                    {openSwitchCount ?? 0} open switch alert{openSwitchCount !== 1 ? 's' : ''} × ${AVG_COMMISSION} avg annual commission
                  </p>
                </div>
              </div>
              <Button asChild variant="outline"
                className="rounded-2xl font-black uppercase text-[10px] tracking-widest border-red-200 text-red-600 hover:bg-red-500/10 h-10 px-5 gap-2">
                <Link href="/dashboard/churn">
                  <AlertTriangle className="w-4 h-4" /> View Alerts
                </Link>
              </Button>
            </CardContent>
          </Card>

          {/* -- Section B: Fax Audit Trail -------------------------------- */}
          <Card className="rounded-3xl border border-border shadow-sm overflow-hidden">
            <CardHeader className="bg-muted/30 border-b">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-black uppercase tracking-tight flex items-center gap-2">
                  <FileText className="w-4 h-4" /> Compliance Vault — Fax Audit Trail
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              {allSubmissions.length === 0 ? (
                <div className="py-16 text-center text-[11px] font-black uppercase tracking-widest text-muted-foreground/50">
                  No VCC submissions yet
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent bg-transparent border-none">
                      {['Client', 'Carrier', 'Broker', 'Status', 'Sent At', 'Deadline', 'PDF'].map(h => (
                        <TableHead key={h} className="font-black uppercase text-[9px] tracking-widest text-muted-foreground py-4 px-4">{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allSubmissions.map(s => {
                      const status = (s.fax_status ?? 'pending') as FaxStatus
                      const cfg    = FAX_CONFIG[status] ?? FAX_CONFIG.pending
                      const dl     = daysLeft(s.deadline_at)
                      const broker = s.broker as unknown as { first_name: string; last_name: string } | null
                      return (
                        <TableRow key={s.id} className="border-border/50 hover:bg-muted/20">
                          <TableCell className="px-4 py-3 font-bold text-sm">{s.client_name}</TableCell>
                          <TableCell className="px-4 text-[10px] font-bold uppercase text-muted-foreground">{s.carrier}</TableCell>
                          <TableCell className="px-4 text-[10px] text-muted-foreground">
                            {broker ? `${broker.first_name} ${broker.last_name}` : '--'}
                          </TableCell>
                          <TableCell className="px-4">
                            <Badge className={`text-[8px] font-black uppercase px-2 border ${cfg.cls}`}>{cfg.label}</Badge>
                          </TableCell>
                          <TableCell className="px-4 text-[10px] text-muted-foreground">{fmt(s.fax_sent_at)}</TableCell>
                          <TableCell className="px-4">
                            <span className={`text-[10px] font-bold flex items-center gap-1 ${dl < 14 ? 'text-red-500' : 'text-muted-foreground'}`}>
                              {dl < 14 && <Clock className="w-3 h-3" />}
                              {fmt(s.deadline_at)}
                              {dl > 0 && dl < 14 && ` (${dl}d)`}
                            </span>
                          </TableCell>
                          <TableCell className="px-4">
                            {s.filled_pdf_path ? (
                              <Button asChild variant="ghost" size="sm"
                                className="h-7 px-2 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-primary/10 hover:text-primary">
                                <Link href={`/dashboard/vcc/${s.id}`}>View</Link>
                              </Button>
                            ) : <span className="text-[10px] text-muted-foreground/40">--</span>}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* ── Compliance Audit Ledger ──────────────────────────────────── */}
          <Card className="rounded-3xl border border-border shadow-sm overflow-hidden">
            <CardHeader className="bg-muted/30 border-b py-4">
              <CardTitle className="text-sm font-black uppercase tracking-tight flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-600" />
                Compliance Audit Ledger
                <span className="text-[9px] font-bold text-muted-foreground normal-case">
                  · immutable · HIPAA §164.312(b)
                </span>
                <span className="ml-auto flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[9px] font-black uppercase tracking-widest text-emerald-600">
                    Live
                  </span>
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {complianceLogs.length === 0 ? (
                <div className="py-16 flex flex-col items-center justify-center gap-2 text-center">
                  <Activity className="w-8 h-8 text-muted-foreground/20" />
                  <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground/40">
                    No compliance events recorded yet
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border/50">
                  {complianceLogs.map((log, idx) => {
                    const cfg    = EVENT_CONFIG[log.event_type as EventType] ?? DEFAULT_EVENT_CFG
                    const Icon   = cfg.icon
                    const broker = log.broker_user_id ? brokerUserMap.get(log.broker_user_id) : null
                    const isLast = idx === complianceLogs.length - 1

                    return (
                      <li key={log.id} className="flex items-start gap-3 px-5 py-3 hover:bg-muted/10 transition-colors">
                        {/* Timeline dot + connector */}
                        <div className="flex flex-col items-center shrink-0 mt-0.5">
                          <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${cfg.dot.replace('bg-', 'bg-').replace('-400', '-500/10')}`}>
                            <Icon className={`w-3.5 h-3.5 ${cfg.dot.replace('bg-', 'text-')}`} />
                          </div>
                          {!isLast && <div className="w-px flex-1 bg-border/40 mt-1 min-h-[12px]" />}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0 space-y-0.5 pb-1">
                          {/* Event label + status */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-black uppercase tracking-widest text-foreground">
                              {cfg.label}
                            </span>
                            <Badge className={`text-[7px] font-black uppercase px-1.5 h-4 border ${
                              log.status === 'SUCCESS' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                              : log.status === 'FAILED'  ? 'bg-red-500/10 text-red-500 border-red-500/20'
                              : 'bg-amber-500/10 text-amber-600 border-amber-500/20'
                            }`}>
                              {log.status}
                            </Badge>
                            {broker && (
                              <span className="text-[9px] text-muted-foreground font-medium truncate">
                                · {broker}
                              </span>
                            )}
                          </div>

                          {/* Description — metadata only, no PHI per HIPAA policy */}
                          <p className="text-[10px] text-muted-foreground font-medium leading-snug line-clamp-2">
                            {log.description}
                          </p>

                          {/* Timestamp */}
                          <div className="flex items-center gap-2">
                            <Clock className="w-2.5 h-2.5 text-muted-foreground/40" />
                            <span className="text-[9px] text-muted-foreground/60 font-medium">
                              {relativeTime(log.created_at)}
                            </span>
                            {log.ip_address && (
                              <span className="text-[8px] text-muted-foreground/30 font-mono">
                                · {log.ip_address}
                              </span>
                            )}
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* -- Section C: Broker Performance ----------------------------- */}
          <Card className="rounded-3xl border border-border shadow-sm overflow-hidden">
            <CardHeader className="bg-muted/30 border-b">
              <CardTitle className="text-sm font-black uppercase tracking-tight flex items-center gap-2">
                <BarChart3 className="w-4 h-4" /> Broker Performance
                <span className="text-[9px] font-bold text-muted-foreground normal-case">sorted by save rate — worst first</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              {brokerStats.length === 0 ? (
                <div className="py-16 text-center text-[11px] font-black uppercase tracking-widest text-muted-foreground/50">
                  No brokers on this agency yet
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent bg-transparent border-none">
                      {['Broker', 'Role', 'Clients', 'Open Alerts', 'VCC', 'AORs Locked', 'Campaigns', 'Save Rate'].map(h => (
                        <TableHead key={h} className="font-black uppercase text-[9px] tracking-widest text-muted-foreground py-4 px-4">{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {brokerStats.map(b => (
                      <TableRow key={b.id} className="border-border/50 hover:bg-muted/20 cursor-pointer"
                        onClick={() => {/* navigate handled by Link wrapper below */}}>
                        <TableCell className="px-4 py-3 font-bold text-sm">
                          <Link href={`/dashboard/manager?brokerId=${b.id}`} className="hover:text-primary transition-colors">
                            {b.name}
                          </Link>
                        </TableCell>
                        <TableCell className="px-4 text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                          {b.role.replace('_', ' ')}
                        </TableCell>
                        <TableCell className="px-4 font-bold text-sm">{b.clients}</TableCell>
                        <TableCell className="px-4">
                          {b.openAlerts > 0 ? (
                            <span className="text-red-600 font-black text-sm">{b.openAlerts}</span>
                          ) : (
                            <span className="text-emerald-600 font-bold text-sm">0</span>
                          )}
                        </TableCell>
                        <TableCell className="px-4 font-bold text-sm">{b.VCC}</TableCell>
                        <TableCell className="px-4">
                          <span className={`text-sm font-black flex items-center gap-1 ${b.aorLocked > 0 ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                            {b.aorLocked > 0 && <Shield className="w-3 h-3" />}
                            {b.aorLocked}
                          </span>
                        </TableCell>
                        <TableCell className="px-4 font-bold text-sm">{b.activeCampaigns}</TableCell>
                        <TableCell className="px-4">
                          {b.saveRate !== null ? (
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${b.saveRate >= 80 ? 'bg-emerald-500' : b.saveRate >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                                  style={{ width: `${b.saveRate}%` }}
                                />
                              </div>
                              <span className={`text-[11px] font-black ${b.saveRate >= 80 ? 'text-emerald-600' : b.saveRate >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                                {b.saveRate}%
                              </span>
                            </div>
                          ) : (
                            <span className="text-[10px] text-muted-foreground/40">No alerts</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
  } catch (err: unknown) {
    console.error('[manager] data fetch error:', err instanceof Error ? err.message : String(err))
    return (
      <div className="flex h-full w-full bg-background items-center justify-center p-8">
        <div className="max-w-sm text-center space-y-3">
          <p className="text-sm font-black uppercase tracking-widest text-foreground">
            Dashboard Temporarily Unavailable
          </p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Agency data could not be loaded. Please refresh the page.
            If this persists, contact support@aegissage.com.
          </p>
        </div>
      </div>
    )
  }
}

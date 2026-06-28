/**
 * /dashboard/admin — Agency Directory
 *
 * Principal-only view (Owner / Manager / CS) that provides:
 *   1. Global client directory — searchable across all brokers in the agency
 *   2. Clinic fax monitor     — VCC delivery status grouped by doctor/clinic
 *   3. Campaign overview      — active retention campaign metrics + link
 *
 * Owner "selling broker" toggle (?view=my_book):
 *   When an owner is also an active selling broker, they can switch between
 *   agency-wide visibility and their own isolated book without breaking seat
 *   limit logic. The toggle is a URL query param so it's bookmarkable and
 *   server-rendered — no client state or extra fetch.
 *
 * Access gate: same tier + role check as /dashboard/manager.
 */

import { redirect }        from 'next/navigation'
import Link                from 'next/link'
import { createClient }    from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { CollectionSidebar }   from '@/components/collection-sidebar'
import { Badge }           from '@/components/ui/badge'
import { Button }          from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Database, Megaphone, FileText, Users, PhoneCall,
  CheckCircle2, AlertTriangle, Clock, Send, XCircle, RefreshCw, Eye,
} from 'lucide-react'
import { ClientDirectory, type DirectoryMember } from './client-directory'

const BROKER_TIERS = ['broker', 'solo', 'starter']

function fmt(d: string | null | undefined) {
  if (!d) return '--'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

// ── Clinic fax monitor helper ─────────────────────────────────────────────────
// Group VCC submissions by doctor_fax (normalised) so owners can see which
// clinics have outstanding, failed, or signed forms across all brokers.

interface ClinicRow {
  key:       string   // normalised fax number or 'no-fax-{name}'
  label:     string   // display label (fax number or doctor name)
  name:      string | null
  carriers:  string[]
  total:     number
  pending:   number
  sent:      number
  failed:    number
  signed:    number
  latestAt:  string | null
}

function buildClinicRows(
  submissions: Array<{
    id: string
    doctor_fax: string | null
    doctor_name: string | null
    carrier: string | null
    fax_status: string | null
    fax_sent_at: string | null
    deadline_at: string
  }>
): ClinicRow[] {
  const map = new Map<string, ClinicRow>()

  for (const s of submissions) {
    const rawFax = s.doctor_fax?.replace(/\D/g, '') ?? null
    const key = rawFax ? rawFax : `no-fax-${(s.doctor_name ?? 'unknown').toLowerCase().replace(/\s+/g, '-')}`
    const label = rawFax
      ? rawFax.length === 10 ? `(${rawFax.slice(0,3)}) ${rawFax.slice(3,6)}-${rawFax.slice(6)}` : s.doctor_fax ?? key
      : s.doctor_name ?? 'Unknown Clinic'

    let row = map.get(key)
    if (!row) {
      row = { key, label, name: s.doctor_name, carriers: [], total: 0, pending: 0, sent: 0, failed: 0, signed: 0, latestAt: null }
      map.set(key, row)
    }

    row.total++
    const st = s.fax_status ?? 'pending'
    if (st === 'pending' || st === 'scheduled') row.pending++
    else if (st === 'sent')   row.sent++
    else if (st === 'failed' || st === 'expired') row.failed++
    else if (st === 'signed') row.signed++

    if (s.carrier && !row.carriers.includes(s.carrier)) row.carriers.push(s.carrier)

    const ts = s.fax_sent_at ?? s.deadline_at
    if (!row.latestAt || ts > row.latestAt) row.latestAt = ts
  }

  // Sort: failed first, then pending, then sent
  return [...map.values()].sort((a, b) => {
    if (a.failed !== b.failed) return b.failed - a.failed
    if (a.pending !== b.pending) return b.pending - a.pending
    return b.total - a.total
  })
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function AdminDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // ── Access gate (identical to /dashboard/manager) ─────────────────────────
  const [{ data: agency }, { data: brokerRow }] = await Promise.all([
    supabase.from('agencies').select('id, subscription_tier').eq('owner_id', user.id).maybeSingle(),
    supabase.from('brokers').select('id, role, agency_id').eq('user_id', user.id).maybeSingle(),
  ])

  const isOwner    = !!agency
  const agencyTier = agency?.subscription_tier ?? 'broker'

  if (isOwner && BROKER_TIERS.includes(agencyTier)) redirect('/dashboard/alerts')

  const staffRoles = ['agency_owner', 'agency_admin', 'customer_service']
  const isStaff    = staffRoles.includes(brokerRow?.role ?? '') || isOwner
  if (!isStaff) redirect('/dashboard/alerts')

  if (!isOwner && brokerRow?.agency_id) {
    const { data: parentAgency } = await supabase
      .from('agencies')
      .select('subscription_tier')
      .eq('id', brokerRow.agency_id)
      .maybeSingle()
    if (BROKER_TIERS.includes(parentAgency?.subscription_tier ?? 'broker')) redirect('/dashboard/alerts')
  }

  const agencyId = agency?.id ?? brokerRow?.agency_id
  if (!agencyId) redirect('/dashboard/alerts')

  // ── Owner "My Book" toggle ────────────────────────────────────────────────
  // ?view=my_book scopes the directory to only the owner's assigned members.
  // This lets selling owners inspect their personal pipeline without changing
  // their principal access level or affecting seat limit calculations.
  const { view } = await searchParams
  const myBookMode = isOwner && view === 'my_book'
  const ownerBrokerId = brokerRow?.id ?? null  // null if owner has no broker row yet

  const svc = createServiceClient()

  // ── Parallel data fetch ───────────────────────────────────────────────────
  let membersQuery = svc
    .from('book_of_business')
    .select('id, full_name, carrier, plan_name, enrollment_status, verification_status, last_marx_check, is_chronic, broker_id')
    .eq('agency_id', agencyId)
    .order('full_name', { ascending: true, nullsFirst: false })
    .limit(1000)

  if (myBookMode && ownerBrokerId) {
    membersQuery = membersQuery.eq('broker_id', ownerBrokerId) as typeof membersQuery
  }

  const [
    membersRes,
    brokersRes,
    submissionsRes,
    campaignCountRes,
    aepCountRes,
  ] = await Promise.all([
    membersQuery,
    svc.from('brokers')
      .select('id, first_name, last_name')
      .eq('agency_id', agencyId)
      .order('last_name'),
    svc.from('vcc_submissions')
      .select('id, doctor_fax, doctor_name, carrier, fax_status, fax_sent_at, deadline_at')
      .eq('agency_id', agencyId)
      .order('deadline_at', { ascending: true }),
    svc.from('campaign_enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('agency_id', agencyId)
      .eq('status', 'active'),
    svc.from('aep_schedule')
      .select('id', { count: 'exact', head: true })
      .eq('agency_id', agencyId),
  ])

  const rawMembers      = membersRes.data     ?? []
  const allBrokers      = brokersRes.data     ?? []
  const rawSubmissions  = submissionsRes.data ?? []
  // Supabase { count: 'exact', head: true } responses expose .count directly;
  // no cast needed — using the result as-is preserves type safety.
  const activeCampaigns = campaignCountRes.count ?? 0
  const aepEnrolled     = aepCountRes.count     ?? 0

  // ── Build broker name map for directory join ───────────────────────────────
  const brokerNameMap = new Map(
    allBrokers.map(b => [b.id, `${b.first_name ?? ''} ${b.last_name ?? ''}`.trim()])
  )

  const members: DirectoryMember[] = rawMembers.map(m => ({
    id:                  m.id,
    full_name:           m.full_name,
    carrier:             m.carrier,
    plan_name:           m.plan_name,
    enrollment_status:   m.enrollment_status,
    verification_status: m.verification_status,
    last_marx_check:     m.last_marx_check,
    is_chronic:          m.is_chronic,
    broker_id:           m.broker_id,
    broker_name:         m.broker_id ? (brokerNameMap.get(m.broker_id) ?? null) : null,
  }))

  const brokerOptions = allBrokers.map(b => ({
    id:   b.id,
    name: `${b.first_name ?? ''} ${b.last_name ?? ''}`.trim(),
  }))

  // ── Clinic fax monitor ────────────────────────────────────────────────────
  const clinicRows = buildClinicRows(rawSubmissions)

  // ── Summary stats ─────────────────────────────────────────────────────────
  const totalFailed   = rawSubmissions.filter(s => s.fax_status === 'failed' || s.fax_status === 'expired').length
  const totalPending  = rawSubmissions.filter(s => s.fax_status === 'pending' || s.fax_status === 'scheduled').length
  const totalSigned   = rawSubmissions.filter(s => s.fax_status === 'signed').length
  const chronicCount  = members.filter(m => m.is_chronic).length

  return (
    <div className="flex h-full w-full bg-background">
      <CollectionSidebar />
      <div className="flex-1 flex flex-col h-full overflow-hidden">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <header className="h-16 border-b border-border px-8 flex items-center gap-4 bg-white/50 backdrop-blur-md sticky top-0 z-10">
          <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
            <Database className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-black text-foreground uppercase tracking-tight">Agency Directory</h1>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              {myBookMode ? 'My Book Only' : `${members.length.toLocaleString()} clients · all brokers`}
            </p>
          </div>

          {/* Owner toggle — My Book / Agency View */}
          {isOwner && ownerBrokerId && (
            <div className="flex items-center rounded-xl border border-border overflow-hidden shrink-0">
              <Link
                href="/dashboard/admin"
                className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition-colors ${
                  !myBookMode
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                Agency
              </Link>
              <Link
                href="/dashboard/admin?view=my_book"
                className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition-colors ${
                  myBookMode
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                My Book
              </Link>
            </div>
          )}
        </header>

        <div className="flex-1 overflow-y-auto p-8 max-w-7xl mx-auto w-full pb-32 space-y-10">

          {/* ── Section 1 — Global Client Directory ─────────────────────── */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-[11px] font-black uppercase tracking-widest text-foreground">
                  Client Directory
                </h2>
                <p className="text-[10px] text-muted-foreground font-medium mt-0.5">
                  {myBookMode ? 'Showing your assigned clients only' : 'All agency clients across all brokers'}
                  {chronicCount > 0 && ` · ${chronicCount} C-SNP / chronic`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge className="bg-primary/10 text-primary border-primary/20 text-[9px] font-black uppercase tracking-widest px-2.5 py-1 border">
                  {members.length.toLocaleString()} total
                </Badge>
              </div>
            </div>
            <ClientDirectory
              members={members}
              brokerOptions={brokerOptions}
              isOwner={isOwner}
            />
          </section>

          {/* ── Section 2 — Clinic Fax Monitor ──────────────────────────── */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-[11px] font-black uppercase tracking-widest text-foreground flex items-center gap-2">
                  <PhoneCall className="w-4 h-4 text-primary" />
                  Clinic Fax Monitor
                </h2>
                <p className="text-[10px] text-muted-foreground font-medium mt-0.5">
                  VCC delivery status grouped by doctor / clinic across all brokers
                </p>
              </div>
              <div className="flex items-center gap-2">
                {totalFailed > 0 && (
                  <Badge className="bg-red-500/10 text-red-600 border-red-500/20 text-[9px] font-black uppercase tracking-widest px-2.5 py-1 border gap-1">
                    <XCircle className="w-2.5 h-2.5" /> {totalFailed} failed
                  </Badge>
                )}
                {totalPending > 0 && (
                  <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-[9px] font-black uppercase tracking-widest px-2.5 py-1 border gap-1">
                    <Clock className="w-2.5 h-2.5" /> {totalPending} pending
                  </Badge>
                )}
                {totalSigned > 0 && (
                  <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-500/20 text-[9px] font-black uppercase tracking-widest px-2.5 py-1 border gap-1">
                    <CheckCircle2 className="w-2.5 h-2.5" /> {totalSigned} signed
                  </Badge>
                )}
              </div>
            </div>

            {clinicRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3 rounded-2xl border border-border bg-muted/10">
                <FileText className="w-8 h-8 text-muted-foreground/30" />
                <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground/50">
                  No VCC submissions yet
                </p>
                <Button asChild size="sm" variant="outline" className="rounded-xl font-black uppercase text-[10px] tracking-widest mt-1">
                  <Link href="/dashboard/vcc">Open VCC Engine →</Link>
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent bg-transparent border-none">
                      {['Doctor / Clinic', 'Carriers', 'Total Forms', 'Pending', 'Sent', 'Failed', 'Signed', 'Last Activity'].map(h => (
                        <TableHead key={h} className="font-black uppercase text-[9px] tracking-widest text-muted-foreground py-4 px-4">{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clinicRows.map(row => (
                      <TableRow key={row.key} className={`border-border/50 hover:bg-muted/20 ${row.failed > 0 ? 'bg-red-500/[0.02]' : ''}`}>
                        <TableCell className="px-4 py-3 min-w-[160px]">
                          <div>
                            {row.name && (
                              <p className="font-bold text-sm text-foreground">{row.name}</p>
                            )}
                            <p className={`font-mono text-[10px] ${row.name ? 'text-muted-foreground' : 'font-bold text-sm text-foreground'}`}>
                              {row.label}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="px-4">
                          <div className="flex flex-wrap gap-1">
                            {row.carriers.slice(0, 3).map(c => (
                              <Badge key={c} className="text-[7px] font-black uppercase px-1.5 bg-muted border-border border">
                                {c}
                              </Badge>
                            ))}
                            {row.carriers.length > 3 && (
                              <Badge className="text-[7px] font-black uppercase px-1.5 bg-muted border-border border">
                                +{row.carriers.length - 3}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="px-4 font-bold text-sm">{row.total}</TableCell>
                        <TableCell className="px-4">
                          {row.pending > 0
                            ? <span className="text-amber-600 font-black text-sm flex items-center gap-1"><Clock className="w-3 h-3" />{row.pending}</span>
                            : <span className="text-muted-foreground/40 text-sm font-bold">0</span>}
                        </TableCell>
                        <TableCell className="px-4">
                          {row.sent > 0
                            ? <span className="text-blue-600 font-black text-sm flex items-center gap-1"><Send className="w-3 h-3" />{row.sent}</span>
                            : <span className="text-muted-foreground/40 text-sm font-bold">0</span>}
                        </TableCell>
                        <TableCell className="px-4">
                          {row.failed > 0
                            ? <span className="text-red-600 font-black text-sm flex items-center gap-1"><XCircle className="w-3 h-3" />{row.failed}</span>
                            : <span className="text-emerald-600 text-sm font-bold">0</span>}
                        </TableCell>
                        <TableCell className="px-4">
                          {row.signed > 0
                            ? <span className="text-emerald-700 font-black text-sm flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{row.signed}</span>
                            : <span className="text-muted-foreground/40 text-sm font-bold">0</span>}
                        </TableCell>
                        <TableCell className="px-4 text-[10px] text-muted-foreground">{fmt(row.latestAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {rawSubmissions.length > 0 && (
              <div className="flex justify-end">
                <Button asChild variant="outline" size="sm" className="rounded-xl font-black uppercase text-[10px] tracking-widest gap-2 h-9">
                  <Link href="/dashboard/vcc">
                    <Eye className="w-3.5 h-3.5" /> Full VCC Submission Log
                  </Link>
                </Button>
              </div>
            )}
          </section>

          {/* ── Section 3 — Campaign Retention ──────────────────────────── */}
          <section className="space-y-4">
            <div>
              <h2 className="text-[11px] font-black uppercase tracking-widest text-foreground flex items-center gap-2">
                <Megaphone className="w-4 h-4 text-primary" />
                Retention Campaigns
              </h2>
              <p className="text-[10px] text-muted-foreground font-medium mt-0.5">
                Proactive client outreach and AEP Shield status
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="rounded-2xl border border-border shadow-sm">
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Megaphone className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-black text-foreground">{activeCampaigns}</p>
                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Active Campaigns</p>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border border-border shadow-sm">
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
                    <RefreshCw className="w-5 h-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-black text-foreground">{aepEnrolled}</p>
                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">AEP Shield Enrollments</p>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border border-border shadow-sm">
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
                    <Users className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-black text-foreground">{chronicCount}</p>
                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">C-SNP / Chronic Members</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Campaign action placeholder */}
            <Card className="rounded-3xl border border-primary/20 bg-primary/5 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-black uppercase tracking-tight flex items-center gap-2">
                  <Megaphone className="w-4 h-4 text-primary" />
                  Proactive Retention Engine
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-4">
                <p className="text-sm text-muted-foreground font-medium leading-relaxed">
                  Trigger AEP outreach, switch-alert follow-up, and chronic-condition check-in campaigns
                  across your entire agency downline. Campaigns respect broker isolation — each broker
                  only receives outreach for their assigned clients.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button asChild className="rounded-xl font-black uppercase text-[10px] tracking-widest h-9 gap-2">
                    <Link href="/dashboard/campaigns">
                      <Megaphone className="w-3.5 h-3.5" /> Manage Campaigns
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className="rounded-xl font-black uppercase text-[10px] tracking-widest h-9 gap-2">
                    <Link href="/dashboard/vcc">
                      <FileText className="w-3.5 h-3.5" /> Bulk VCC Dispatch
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </section>

        </div>
      </div>
    </div>
  )
}

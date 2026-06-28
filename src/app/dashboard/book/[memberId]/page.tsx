import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  ArrowLeft, User, Shield, CheckCircle2,
  AlertTriangle, Clock, KeyRound, Database,
} from 'lucide-react'
import { MbiForm } from '@/components/mbi-form'
import { DoctorInfoCard } from '@/components/doctor-info-card'

function fmt(d: string | null | undefined) {
  if (!d) return '--'
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ memberId: string }>
}) {
  const { memberId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: agency }, { data: brokerRow }] = await Promise.all([
    supabase.from('agencies').select('id').eq('owner_id', user.id).maybeSingle(),
    supabase.from('brokers').select('id, role, agency_id').eq('user_id', user.id).maybeSingle(),
  ])

  const agencyId = agency?.id ?? brokerRow?.agency_id
  if (!agencyId) redirect('/login')

  const supabaseAdmin = createServiceClient()

  const { data: member } = await supabaseAdmin
    .from('book_of_business')
    .select(`
      id, full_name, carrier, carrier_display_name, plan_name,
      status, verification_status, last_verified_at, first_seen_at,
      has_mbi, last_marx_check, last_known_plan_code, marx_verified_at,
      member_id, enrollment_status, plan_effective_date, plan_end_date,
      future_plan_code, future_plan_name, future_effective_date,
      marx_raw_snapshot, doctor_name, doctor_fax, is_chronic
    `)
    .eq('id', memberId)
    .eq('agency_id', agencyId)
    .single()

  if (!member) notFound()

  const verificationCls = {
    verified: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    missing:  'bg-red-500/10 text-red-400 border-red-500/20',
    pending:  'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  }[(member.verification_status ?? 'pending') as string] ?? 'bg-slate-500/10 text-slate-400 border-slate-500/20'

  const statusCls = member.status === 'active'
    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
    : 'bg-red-500/10 text-red-400 border-red-500/20'

  return (
    <div className="flex flex-col h-full w-full bg-background">
      <header className="h-16 border-b border-slate-800 px-6 flex items-center gap-3 bg-slate-950/80 backdrop-blur-md sticky top-0 z-10">
        <Link href="/dashboard/book">
          <Button variant="ghost" size="sm" className="gap-2 text-slate-400 hover:text-white">
            <ArrowLeft className="w-4 h-4" />
            <span className="text-[10px] font-black uppercase tracking-widest">Book</span>
          </Button>
        </Link>
        <div className="w-px h-5 bg-slate-800" />
        <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
          <User className="w-4 h-4 text-primary" />
        </div>
        <p className="text-sm font-black text-white truncate">{member.full_name ?? 'Member'}</p>
      </header>

      <div className="flex-1 overflow-y-auto p-6 pb-24 space-y-5 max-w-2xl mx-auto w-full">

        {/* Member overview */}
        <Card className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Member Info</p>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Name</span>
              <span className="text-sm font-black text-white">{member.full_name ?? '--'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Carrier</span>
              <span className="text-sm text-white">{member.carrier_display_name ?? member.carrier ?? '--'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Plan</span>
              <span className="text-sm text-white">{member.plan_name ?? '--'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Member ID</span>
              <span className="text-xs text-slate-400 font-mono">{member.member_id ?? '--'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Status</span>
              <Badge className={`font-black uppercase text-[8px] px-2 h-5 border ${statusCls}`}>
                {member.status ?? 'unknown'}
              </Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Verification</span>
              <Badge className={`font-black uppercase text-[8px] px-2 h-5 border ${verificationCls}`}>
                {(member.verification_status ?? 'pending').replace(/_/g, ' ')}
              </Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Last Verified</span>
              <span className="text-xs text-slate-400">{fmt(member.last_verified_at)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">First Seen</span>
              <span className="text-xs text-slate-400">{fmt(member.first_seen_at)}</span>
            </div>
          </div>
        </Card>

        {/* MBI section */}
        <Card className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-primary" />
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
              Medicare Beneficiary ID (MBI)
            </p>
          </div>
          <MbiForm memberId={memberId} hasMbi={member.has_mbi ?? false} />
        </Card>

        {/* Physician / VCC */}
        <DoctorInfoCard
          memberId={memberId}
          bobId={memberId}
          initialDoctorName={(member as Record<string, unknown>).doctor_name as string | null ?? null}
          initialDoctorFax={(member as Record<string, unknown>).doctor_fax as string | null ?? null}
        />

        {/* MARx verification status */}
        <Card className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-400" />
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
              MARx Verification
            </p>
          </div>
          {member.last_marx_check ? (
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500">Last MARx Check</span>
                <span className="text-xs text-white">{fmt(member.last_marx_check)}</span>
              </div>
              {member.last_known_plan_code && (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500">Known Plan Code</span>
                  <span className="text-xs font-mono text-slate-300">{member.last_known_plan_code}</span>
                </div>
              )}
              {member.marx_verified_at && (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500">Verified At</span>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <span className="text-xs text-emerald-400">{fmt(member.marx_verified_at)}</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-slate-500">
              <Clock className="w-3.5 h-3.5" />
              <span className="text-xs">
                {member.has_mbi
                  ? 'MBI saved — MARx lookup will run on next extension sync'
                  : 'Add an MBI above to enable MARx verification'}
              </span>
            </div>
          )}
          {!member.has_mbi && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-blue-500/5 border border-blue-500/20">
              <AlertTriangle className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
              <p className="text-[10px] text-blue-400 leading-relaxed">
                MARx lookup cross-checks CMS enrollment data against the carrier roster.
                Add an MBI to enable this additional layer of switch detection.
              </p>
            </div>
          )}
        </Card>

        {/* MARx Enrollment History */}
        <Card className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-blue-400" />
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
              Enrollment History (from CMS MARx)
            </p>
          </div>

          {(member.marx_raw_snapshot as Record<string, string>[] | null)?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-800">
                    {['Contract', 'PBP', 'Plan', 'Start', 'End', 'Drug Plan'].map(h => (
                      <th key={h} className="text-left pb-2 pr-4 text-[9px] font-black uppercase tracking-widest text-slate-500">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(member.marx_raw_snapshot as Record<string, string>[]).map((row, i) => {
                    const isActive = !row.End || row.End.trim() === '' || row.End.trim() === 'N/A'
                    return (
                      <tr key={i} className={`border-b border-slate-800/50 ${isActive ? 'bg-emerald-500/5' : ''}`}>
                        <td className="py-2 pr-4 font-mono text-slate-300">{row.contract ?? row.Contract ?? '--'}</td>
                        <td className="py-2 pr-4 font-mono text-slate-300">{row.pbp ?? row.PBP ?? '--'}</td>
                        <td className="py-2 pr-4 text-slate-400 max-w-[200px] truncate">
                          {row.planDescription ?? row['Plan Type Code & Description'] ?? row.Plan ?? '--'}
                          {isActive && <span className="ml-1.5 text-[8px] font-black text-emerald-400 uppercase">Active</span>}
                        </td>
                        <td className="py-2 pr-4 text-slate-500">{row.startDate ?? row.Start ?? '--'}</td>
                        <td className="py-2 pr-4 text-slate-500">{row.endDate ?? row.End ?? <span className="text-emerald-400/60">—</span>}</td>
                        <td className="py-2 text-slate-500">{row.drugPlan ?? row['Drug Plan'] ?? '--'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex items-start gap-2 text-slate-500">
              <Clock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <p className="text-xs leading-relaxed">
                No MARx verification on file.{' '}
                {member.has_mbi
                  ? 'Run MARx verification via the extension to see enrollment history.'
                  : 'Add this member\'s MBI and run MARx verification to see their enrollment history.'}
              </p>
            </div>
          )}
        </Card>

      </div>
    </div>
  )
}

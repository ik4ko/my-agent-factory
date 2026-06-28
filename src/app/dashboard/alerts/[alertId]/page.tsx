import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  ArrowLeft, AlertTriangle, Clock, Shield,
  CheckCircle2, XCircle,
} from 'lucide-react'

const SCORE_LABELS: Record<string, string> = {
  initial_scrape:      'Not found on roster (initial scan)',
  second_consecutive:  'Still missing — 2nd consecutive sync',
  third_consecutive:   'Still missing — 3rd consecutive sync',
  commission_match:    'Commission data confirms missing',
  marx_lookup:         'MARX lookup confirms disenrollment',
  decay_applied:       'Decay adjustment',
}

function fmt(d: string | null | undefined) {
  if (!d) return '--'
  return new Date(d).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

function timeAgo(d: string | null | undefined) {
  if (!d) return ''
  const ms = Date.now() - new Date(d).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default async function AlertDetailPage({
  params,
}: {
  params: Promise<{ alertId: string }>
}) {
  const { alertId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: agency }, { data: brokerRow }] = await Promise.all([
    supabase.from('agencies').select('id').eq('owner_id', user.id).maybeSingle(),
    supabase.from('brokers').select('id, role, agency_id').eq('user_id', user.id).maybeSingle(),
  ])

  const agencyId = agency?.id ?? brokerRow?.agency_id
  if (!agencyId) redirect('/login')

  const isStaff = ['agency_owner', 'agency_admin', 'customer_service'].includes(brokerRow?.role ?? '') || !!agency

  const supabaseAdmin = createServiceClient()

  const { data: alert } = await supabaseAdmin
    .from('switch_alerts')
    .select(`
      id, agency_id, broker_id, bob_member_id, carrier,
      alert_type, previous_value, new_value, priority, status,
      detection_source, detected_at, created_at,
      confidence_score, confidence_status,
      detection_log_id, resolution, resolved_at, resolved_by,
      acknowledged_at, acknowledged_by
    `)
    .eq('id', alertId)
    .eq('agency_id', agencyId)
    .single()

  if (!alert) notFound()

  // Fetch member, detection log, and broker in parallel
  const [{ data: member }, { data: detectionLog }, { data: broker }] = await Promise.all([
    alert.bob_member_id
      ? supabaseAdmin
          .from('book_of_business')
          .select('id, full_name, plan_name, carrier_display_name, date_of_birth, phone_primary')
          .eq('id', alert.bob_member_id)
          .single()
      : Promise.resolve({ data: null }),
    alert.detection_log_id
      ? supabaseAdmin
          .from('member_detection_log')
          .select('score_components, consecutive_missing_count, first_detected_at, last_confirmed_missing_at')
          .eq('id', alert.detection_log_id)
          .single()
      : Promise.resolve({ data: null }),
    alert.broker_id
      ? supabaseAdmin
          .from('brokers')
          .select('full_name, email')
          .eq('id', alert.broker_id)
          .single()
      : Promise.resolve({ data: null }),
  ])

  const C = alert.confidence_score ?? 0
  const components = (detectionLog as any)?.score_components ?? {}

  const memberDisplayName = (member as any)?.full_name
    ?? (alert.bob_member_id ? `Member #${alert.bob_member_id.slice(0, 8)}` : null)

  const detectionDescription = (() => {
    const at = alert.alert_type
    if (at === 'termed') return 'Member no longer has active MA plan'
    if (at === 'plan_switch') {
      const prev = alert.previous_value && alert.previous_value !== 'unknown' ? alert.previous_value : null
      const next = alert.new_value && alert.new_value !== 'unknown' ? alert.new_value : null
      if (prev && next) return `Plan changed — ${prev} → ${next}`
      return 'Plan changed'
    }
    if (at === 'carrier_switch') return 'Carrier changed'
    if (at === 'pending_switch') return 'Future plan change detected'
    if (at === 'aor_change') return 'Agent of Record changed'
    return null
  })()

  // scoreLines must be declared before showConfidence to avoid TDZ crash
  const scoreLines = Object.entries(components)
    .filter(([, v]) => (v as number) !== 0)
    .map(([k, v]) => ({
      key: k,
      label: SCORE_LABELS[k] ?? k.replace(/_/g, ' '),
      points: v as number,
    }))

  const showConfidence = C > 0 || scoreLines.length > 0

  const borderCls = C >= 85
    ? 'border-red-500/30'
    : C >= 70
    ? 'border-orange-500/30'
    : C >= 60
    ? 'border-yellow-500/30'
    : 'border-slate-800'

  const statusCls = ({
    open: 'bg-red-500/10 text-red-400 border-red-500/20',
    contacted: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    resolved: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    dismissed: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  } as Record<string, string>)[alert.status ?? 'open'] ?? ''

  return (
    <div className="flex flex-col h-full w-full bg-background">
      <header className="h-16 border-b border-slate-800 px-6 flex items-center gap-3 bg-slate-950/80 backdrop-blur-md sticky top-0 z-10">
        <Link href="/dashboard/alerts">
          <Button variant="ghost" size="sm" className="gap-2 text-slate-400 hover:text-white">
            <ArrowLeft className="w-4 h-4" />
            <span className="text-[10px] font-black uppercase tracking-widest">Alerts</span>
          </Button>
        </Link>
        <div className="w-px h-5 bg-slate-800" />
        <p className="text-sm font-black text-white truncate">
          {memberDisplayName ?? 'Alert Detail'}
        </p>
        <Badge className={`font-black uppercase text-[8px] px-2 h-5 border ml-2 ${statusCls}`}>
          {(alert.status ?? 'open').replace(/_/g, ' ')}
        </Badge>
      </header>

      <div className="flex-1 overflow-y-auto p-6 pb-24 space-y-6 max-w-3xl mx-auto w-full">

        {/* Member Card */}
        <Card className={`rounded-2xl border ${borderCls} bg-slate-900/60 p-5 space-y-3`}>
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Member</p>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-xl font-black text-white">
                {memberDisplayName ?? <span className="text-slate-500">Unknown</span>}
              </p>
              <p className="text-sm text-slate-400">
                {(member as any)?.carrier_display_name ?? alert.carrier ?? 'Unknown Carrier'}
                {(member as any)?.plan_name && ` · ${(member as any).plan_name}`}
              </p>
              {isStaff && (broker as any)?.full_name && (
                <p className="text-xs text-slate-500">Broker: {(broker as any).full_name}</p>
              )}
            </div>
            <div className="text-right space-y-1">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Detected</p>
              <p className="text-xs text-white font-medium">{fmt(alert.detected_at)}</p>
              <p className="text-[10px] text-slate-500">{timeAgo(alert.detected_at)}</p>
            </div>
          </div>
        </Card>

        {/* Confidence Score Breakdown — only for scored detections */}
        {showConfidence ? (
          <Card className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                Detection Confidence
              </p>
              <span className={`text-2xl font-black ${C >= 85 ? 'text-red-400' : C >= 70 ? 'text-orange-400' : C >= 60 ? 'text-yellow-400' : 'text-slate-400'}`}>
                {C}%
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-800">
              <div
                className={`h-2 rounded-full transition-all ${C > 70 ? 'bg-red-500' : C >= 40 ? 'bg-yellow-500' : 'bg-slate-600'}`}
                style={{ width: `${Math.min(C, 100)}%` }}
              />
            </div>
            {scoreLines.length > 0 && (
              <div className="space-y-2 pt-1">
                {scoreLines.map(({ key, label, points }) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">{label}</span>
                    <span className={`text-xs font-black ${points > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {points > 0 ? '+' : ''}{points} pts
                    </span>
                  </div>
                ))}
                <div className="border-t border-slate-800 pt-2 flex items-center justify-between">
                  <span className="text-xs font-black text-white uppercase tracking-widest">Total</span>
                  <span className="text-xs font-black text-white">{C} / 100</span>
                </div>
              </div>
            )}
            {alert.confidence_status && (
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                Status: {alert.confidence_status.replace(/_/g, ' ')}
              </p>
            )}
          </Card>
        ) : detectionDescription ? (
          <Card className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Detection</p>
            <p className="text-sm font-bold text-white">{detectionDescription}</p>
            {alert.detection_source === 'marx_extension' && (
              <p className="text-[10px] text-slate-500 font-medium uppercase tracking-widest">
                Source: CMS MARx — verified
              </p>
            )}
          </Card>
        ) : null}

        {/* Detection Timeline */}
        <Card className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Timeline</p>
          <div className="space-y-3">
            {(detectionLog as any)?.first_detected_at && (
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-yellow-500/10 flex items-center justify-center shrink-0 mt-0.5">
                  <AlertTriangle className="w-3 h-3 text-yellow-400" />
                </div>
                <div>
                  <p className="text-xs font-black text-white">First detected missing</p>
                  <p className="text-[10px] text-slate-500">{fmt((detectionLog as any).first_detected_at)}</p>
                </div>
              </div>
            )}
            {(detectionLog as any)?.last_confirmed_missing_at && (
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-red-500/10 flex items-center justify-center shrink-0 mt-0.5">
                  <XCircle className="w-3 h-3 text-red-400" />
                </div>
                <div>
                  <p className="text-xs font-black text-white">
                    Last confirmed missing
                    {(detectionLog as any).consecutive_missing_count > 1 && (
                      <span className="ml-1 text-slate-500 font-normal">
                        ({(detectionLog as any).consecutive_missing_count} consecutive syncs)
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-slate-500">{fmt((detectionLog as any).last_confirmed_missing_at)}</p>
                </div>
              </div>
            )}
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-red-500/10 flex items-center justify-center shrink-0 mt-0.5">
                <Clock className="w-3 h-3 text-red-400" />
              </div>
              <div>
                <p className="text-xs font-black text-white">Alert created</p>
                <p className="text-[10px] text-slate-500">{fmt(alert.created_at)}</p>
              </div>
            </div>
            {alert.acknowledged_at && (
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Shield className="w-3 h-3 text-blue-400" />
                </div>
                <div>
                  <p className="text-xs font-black text-white">Acknowledged</p>
                  <p className="text-[10px] text-slate-500">{fmt(alert.acknowledged_at)}</p>
                </div>
              </div>
            )}
            {alert.resolved_at && (
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0 mt-0.5">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                </div>
                <div>
                  <p className="text-xs font-black text-white">
                    Resolved
                    {alert.resolution && (
                      <span className="ml-1 text-slate-500 font-normal">
                        · {alert.resolution.replace(/_/g, ' ')}
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-slate-500">{fmt(alert.resolved_at)}</p>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Detection metadata */}
        {(alert.detection_source || alert.alert_type) && (
          <Card className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Detection Info</p>
            {alert.alert_type && (
              <div className="flex justify-between">
                <span className="text-xs text-slate-500">Type</span>
                <span className="text-xs text-white font-medium">{alert.alert_type.replace(/_/g, ' ')}</span>
              </div>
            )}
            {alert.detection_source && (
              <div className="flex justify-between">
                <span className="text-xs text-slate-500">Source</span>
                <span className="text-xs text-white font-medium">{alert.detection_source.replace(/_/g, ' ')}</span>
              </div>
            )}
            {alert.previous_value && (
              <div className="flex justify-between">
                <span className="text-xs text-slate-500">Previous Plan</span>
                <span className="text-xs text-white font-medium">{alert.previous_value}</span>
              </div>
            )}
            {alert.new_value && (
              <div className="flex justify-between">
                <span className="text-xs text-slate-500">New Plan</span>
                <span className="text-xs text-white font-medium">{alert.new_value}</span>
              </div>
            )}
          </Card>
        )}

      </div>
    </div>
  )
}

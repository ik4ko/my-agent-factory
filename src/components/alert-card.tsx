'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Badge }  from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card }   from '@/components/ui/card'
import {
  AlertTriangle, Bell, CheckCircle2, Clock,
  PhoneCall, XCircle, ArrowRight, Flag, ArrowLeftRight,
  Sparkles, ShieldCheck, Loader2,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

// ── Shared type ───────────────────────────────────────────────────────────────

export type AlertRow = {
  id: string
  broker_id: string | null
  bob_member_id: string | null
  carrier: string | null
  alert_type: string | null
  previous_value: string | null
  new_value: string | null
  priority: string | null
  status: string | null
  detection_source: string | null
  detected_at: string | null
  created_at: string | null
  confidence_score?: number | null
  confidence_status?: string | null
  member_full_name: string | null
  member_plan: string | null
  carrier_display: string | null
  broker_full_name?: string | null
  switch_type?: string | null
  previous_plan_code?: string | null
  new_plan_code?: string | null
  new_plan_name?: string | null
  effective_date?: string | null
  end_date?: string | null
  previous_carrier?: string | null
  new_carrier?: string | null
  // Retained in type for data completeness — not displayed in UI
  estimated_revenue_at_risk?: number | null
}

export type AlertStatus = 'contacted' | 'resolved' | 'mitigating'

// ── Typology system ───────────────────────────────────────────────────────────
//
// Three canonical operational event types that every alert maps to:
//
//   flight_risk  — Member has declared or shows strong intention to switch.
//                  Broker still has a window to intervene.
//
//   switched     — Plan or carrier change has already executed, or member
//                  has disenrolled. The event is a fait accompli.
//
//   secured      — Broker has confirmed the client is re-anchored.
//                  Alert is resolved; retention confirmed.

export type AlertTypology = 'flight_risk' | 'switched' | 'secured'

const FLIGHT_RISK_TYPES  = new Set(['future_plan_change', 'plan_switch', 'pending_switch'])
const SWITCHED_TYPES     = new Set(['plan_changed', 'carrier_switch', 'termed', 'fully_disenrolled'])

export function getAlertTypology(alert: AlertRow): AlertTypology {
  if (alert.status === 'resolved') return 'secured'
  const st = alert.switch_type ?? ''
  if (SWITCHED_TYPES.has(st))     return 'switched'
  if (FLIGHT_RISK_TYPES.has(st))  return 'flight_risk'
  // Open/contacted/mitigating alerts without a specific switch_type signal
  // are treated as flight-risk until confirmed otherwise.
  return 'flight_risk'
}

export const TYPOLOGY_CFG: Record<AlertTypology, {
  label:   string
  icon:    typeof AlertTriangle
  chip:    string       // badge className
  border:  string       // left border colour
  bar:     string       // confidence bar colour
}> = {
  flight_risk: {
    label:  'Flight Risk',
    icon:   AlertTriangle,
    chip:   'bg-amber-500/10 text-amber-400 border-amber-500/20 border',
    border: 'border-l-amber-500',
    bar:    'bg-amber-500',
  },
  switched: {
    label:  'Plan Switched',
    icon:   XCircle,
    chip:   'bg-rose-500/10 text-rose-400 border-rose-500/20 border',
    border: 'border-l-rose-500',
    bar:    'bg-rose-500',
  },
  secured: {
    label:  'Retention Secured',
    icon:   ShieldCheck,
    chip:   'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 border',
    border: 'border-l-emerald-600',
    bar:    'bg-emerald-500',
  },
}

interface Props {
  alert: AlertRow
  isStaff?: boolean
  onStatusChange?: (alertId: string, status: AlertStatus) => void
  onFalseAlarm?:  (alertId: string) => void
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

function timeAgoVerbose(d: string | null | undefined): string {
  if (!d) return ''
  const ms   = Date.now() - new Date(d).getTime()
  const mins = Math.floor(ms / 60_000)
  if (mins < 60)  return `Detected ${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `Detected ${hrs}h ago`
  return `Detected ${Math.floor(hrs / 24)}d ago`
}

function fmtFull(d: string | null | undefined): string {
  if (!d) return '--'
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: '2-digit',
    hour: 'numeric', minute: '2-digit',
  })
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '--'
  return new Date(d).toLocaleDateString('en-US', {
    month: 'numeric', day: 'numeric', year: 'numeric',
  })
}

function parseCarrierFromValue(val: string | null | undefined): string | null {
  if (!val) return null
  return val.includes('|') ? val.split('|')[0].trim() : val.trim()
}

function parsePlanFromValue(val: string | null | undefined): string | null {
  if (!val || !val.includes('|')) return null
  return val.split('|').slice(1).join('|').trim()
}

// ── Switch-type body ───────────────────────────────────────────────────────────

function AlertBody({ alert }: { alert: AlertRow }) {
  const st = alert.switch_type

  const planDisplay = (alert.member_plan && alert.member_plan !== 'unknown' && alert.member_plan !== 'Unknown Plan')
    ? alert.member_plan
    : (alert.carrier_display ?? alert.carrier) || 'Unknown Plan'

  if (st === 'carrier_switch') {
    const fromCarrier = alert.previous_carrier ?? alert.carrier_display ?? parseCarrierFromValue(alert.previous_value) ?? 'Previous Carrier'
    const toCarrier   = alert.new_carrier ?? parseCarrierFromValue(alert.new_value) ?? alert.carrier ?? 'New Carrier'
    const fromPlan    = alert.member_plan ?? parsePlanFromValue(alert.previous_value)
    const toPlan      = alert.new_plan_name ?? parsePlanFromValue(alert.new_value)

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="min-w-0 space-y-0.5">
            <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/60">From</p>
            <p className="text-xs font-bold text-muted-foreground truncate">{fromCarrier}</p>
            {fromPlan && <p className="text-[10px] text-muted-foreground/60 truncate">{fromPlan}</p>}
          </div>
          <ArrowRight className="w-4 h-4 text-rose-500 shrink-0" />
          <div className="min-w-0 space-y-0.5">
            <p className="text-[8px] font-black uppercase tracking-widest text-rose-400">Switched To</p>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0 animate-pulse" />
              <p className="text-xs font-black text-foreground truncate">{toCarrier}</p>
            </div>
            {toPlan && <p className="text-[10px] text-muted-foreground/60 truncate">{toPlan}</p>}
          </div>
        </div>
        <p className="text-[9px] uppercase tracking-widest text-muted-foreground/40 font-bold">
          Ghost Churn Monitor · Cross-carrier detection
        </p>
      </div>
    )
  }

  if (st === 'plan_switch') {
    const carrier  = alert.previous_carrier ?? alert.carrier_display ?? alert.carrier ?? 'Carrier'
    const fromPlan = alert.member_plan ?? parsePlanFromValue(alert.previous_value) ?? alert.previous_value ?? 'Previous Plan'
    const toPlan   = alert.new_plan_name ?? parsePlanFromValue(alert.new_value) ?? alert.new_value ?? 'New Plan'

    return (
      <div className="space-y-2">
        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">{carrier}</p>
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground font-medium truncate max-w-[40%]">{fromPlan}</p>
          <ArrowRight className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
            <p className="text-xs font-black text-amber-300 truncate">{toPlan}</p>
          </div>
        </div>
        <p className="text-[9px] uppercase tracking-widest text-muted-foreground/40 font-bold">
          Ghost Churn Monitor · Plan switch detected
        </p>
      </div>
    )
  }

  if (st === 'termed') {
    return (
      <div className="space-y-1 text-xs">
        <p className="text-muted-foreground">
          <span className="text-muted-foreground/60">Left: </span>{planDisplay}
          {alert.previous_plan_code && ` (${alert.previous_plan_code})`}
        </p>
        {alert.end_date && (
          <p className="text-muted-foreground/80">
            <span className="text-muted-foreground/60">Plan ended: </span>{fmtDate(alert.end_date)}
          </p>
        )}
        <p className="text-[9px] uppercase tracking-widest text-muted-foreground/40 font-bold pt-0.5">
          Source: CMS MARx (verified)
        </p>
      </div>
    )
  }

  if (st === 'future_plan_change') {
    return (
      <div className="space-y-1 text-xs">
        <p className="text-muted-foreground">
          <span className="text-muted-foreground/60">Currently: </span>{planDisplay}
          {alert.previous_plan_code && ` (${alert.previous_plan_code})`}
        </p>
        <p className="text-amber-300 font-medium">
          <span className="text-muted-foreground/60">Switching to: </span>
          {alert.new_plan_name ?? alert.new_plan_code ?? 'Unknown plan'}
          {alert.new_plan_code && ` (${alert.new_plan_code})`}
        </p>
        {alert.effective_date && (
          <p className="text-muted-foreground/80">
            <span className="text-muted-foreground/60">Effective: </span>{fmtDate(alert.effective_date)}
          </p>
        )}
        <p className="text-[9px] uppercase tracking-widest text-muted-foreground/40 font-bold pt-0.5">
          Source: CMS MARx · AEP enrollment detected
        </p>
      </div>
    )
  }

  if (st === 'plan_changed') {
    return (
      <div className="space-y-1 text-xs">
        <p className="text-muted-foreground">
          <span className="text-muted-foreground/60">Was on: </span>{planDisplay}
          {alert.previous_plan_code && ` (${alert.previous_plan_code})`}
        </p>
        <p className="text-rose-300 font-medium">
          <span className="text-muted-foreground/60">Now on: </span>
          {alert.new_plan_name ?? alert.new_plan_code ?? 'Unknown plan'}
          {alert.new_plan_code && ` (${alert.new_plan_code})`}
        </p>
        <p className="text-[9px] uppercase tracking-widest text-muted-foreground/40 font-bold pt-0.5">
          Detected via: CMS MARx
        </p>
      </div>
    )
  }

  if (st === 'fully_disenrolled') {
    return (
      <div className="space-y-1 text-xs">
        <p className="text-rose-400 font-medium">No active Medicare plan found in MARx</p>
        <p className="text-[9px] uppercase tracking-widest text-muted-foreground/40 font-bold pt-0.5">
          Source: CMS MARx (verified)
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-1 text-xs">
      {alert.new_value && <p className="text-muted-foreground">{alert.new_value}</p>}
      {alert.detection_source && (
        <p className="text-[9px] uppercase tracking-widest text-muted-foreground/40 font-bold pt-0.5">
          Source: {alert.detection_source.replace(/_/g, ' ')}
        </p>
      )}
    </div>
  )
}

// ── Main card ─────────────────────────────────────────────────────────────────

export function AlertCard({ alert, isStaff, onStatusChange, onFalseAlarm }: Props) {
  const [busy, setBusy]               = useState<string | null>(null)
  const [shieldState, setShieldState] = useState<'idle' | 'launching' | 'active' | 'error'>('idle')
  const [scriptPreview, setScriptPreview] = useState<string | null>(null)

  const C        = alert.confidence_score ?? 0
  const typology = getAlertTypology(alert)
  const tCfg     = TYPOLOGY_CFG[typology]
  const TypIcon  = tCfg.icon

  // Workflow status badge
  const workflowBadgeCls = ({
    open:       'bg-red-500/10 text-red-400 border-red-500/20',
    contacted:  'bg-amber-500/10 text-amber-400 border-amber-500/20',
    mitigating: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
    resolved:   'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    dismissed:  'bg-muted/10 text-muted-foreground border-border',
  } as Record<string, string>)[alert.status ?? 'open']
    ?? 'bg-muted/10 text-muted-foreground border-border'

  const isOpen       = alert.status === 'open'
  const isContacted  = alert.status === 'contacted'
  const isMitigating = alert.status === 'mitigating'
  const isActionable = isOpen || isContacted

  // ── Handlers ──────────────────────────────────────────────────────────────────

  async function handleStatusChange(status: AlertStatus) {
    setBusy(status)
    try {
      const supabase = createClient()
      await supabase
        .from('switch_alerts')
        .update({
          status,
          resolved_at: status === 'resolved' ? new Date().toISOString() : null,
        })
        .eq('id', alert.id)
      onStatusChange?.(alert.id, status)
    } finally {
      setBusy(null)
    }
  }

  async function handleFalseAlarm() {
    setBusy('false_alarm')
    try {
      await fetch(`/api/alerts/${alert.id}/false-alarm`, { method: 'POST' })
      onFalseAlarm?.(alert.id)
    } finally {
      setBusy(null)
    }
  }

  async function handleLaunchShield() {
    if (!alert.bob_member_id) return
    setShieldState('launching')
    try {
      const supabase = createClient()
      await supabase.from('switch_alerts').update({ status: 'mitigating' }).eq('id', alert.id)
      onStatusChange?.(alert.id, 'mitigating')

      const res  = await fetch('/api/ai/generate-script', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ memberId: alert.bob_member_id, alertId: alert.id }),
      })
      const data = await res.json() as {
        success?: boolean; smsDraft?: string; phoneScript?: string; error?: string
      }
      if (!res.ok || !data.success) throw new Error(data.error ?? 'Script generation failed')
      setScriptPreview(data.smsDraft ?? data.phoneScript ?? null)
      setShieldState('active')
    } catch {
      setShieldState('error')
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <Card className={cn(
      'rounded-2xl border border-border border-l-4 bg-card overflow-hidden',
      tCfg.border
    )}>
      <div className="p-4">
        <div className="flex items-start gap-4">

          {/* Typology icon */}
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-muted/30">
            <TypIcon className={cn(
              'w-4 h-4',
              typology === 'flight_risk' ? 'text-amber-400'
              : typology === 'switched'  ? 'text-rose-400'
              : 'text-emerald-400'
            )} />
          </div>

          {/* Body */}
          <div className="flex-1 min-w-0 space-y-2">

            {/* Typology chip + workflow status badge */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={cn('font-black uppercase text-[8px] px-2 h-5', tCfg.chip)}>
                {tCfg.label}
              </Badge>
              <Badge className={cn(
                'font-black uppercase text-[8px] px-2 h-5 border cursor-default pointer-events-none',
                workflowBadgeCls
              )}>
                {(alert.status ?? 'open').replace(/_/g, ' ')}
              </Badge>
              {isStaff && alert.broker_full_name && (
                <span className="text-[9px] text-muted-foreground font-medium ml-auto">
                  {alert.broker_full_name}
                </span>
              )}
            </div>

            {/* Member name */}
            <p className="text-sm font-black text-foreground">
              {alert.member_full_name ?? (
                <span className="text-muted-foreground italic font-normal">Unknown Member</span>
              )}
            </p>

            {/* Carrier / plan context */}
            {(alert.carrier_display ?? alert.carrier ?? alert.member_plan) && (
              <p className="text-[10px] text-muted-foreground font-medium">
                {alert.carrier_display ?? alert.carrier}
                {alert.member_plan && (
                  <span className="text-muted-foreground/60"> · {alert.member_plan}</span>
                )}
              </p>
            )}

            {/* Switch visualization */}
            <AlertBody alert={alert} />

            {/* Timestamp row — no financial data */}
            <div className="flex items-center gap-2 flex-wrap pt-0.5">
              <span className="text-[10px] text-muted-foreground/60 font-medium flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {timeAgoVerbose(alert.detected_at)}
                <span className="text-muted-foreground/30 mx-1">·</span>
                {fmtFull(alert.detected_at)}
              </span>
              {C > 0 && (
                <span className={cn(
                  'text-[10px] font-black ml-auto',
                  C >= 85 ? 'text-rose-400' : C >= 70 ? 'text-amber-400' : 'text-muted-foreground'
                )}>
                  {C}% conf.
                </span>
              )}
            </div>

            {/* Confidence bar */}
            {C > 0 && (
              <div className="h-0.5 w-full rounded-full bg-muted">
                <div
                  className={cn('h-0.5 rounded-full transition-all', tCfg.bar)}
                  style={{ width: `${Math.min(C, 100)}%` }}
                />
              </div>
            )}
          </div>

          {/* Right-side action column */}
          <div className="flex flex-col items-end gap-1.5 shrink-0">

            {/* Launch Shield — primary CTA for open flight-risk alerts */}
            {isOpen && alert.bob_member_id && shieldState === 'idle' && (
              <Button
                onClick={handleLaunchShield}
                disabled={!!busy}
                size="sm"
                className="h-8 px-3 rounded-xl text-[9px] font-black uppercase tracking-widest bg-violet-600 hover:bg-violet-500 text-white gap-1.5 shadow-lg shadow-violet-900/40 whitespace-nowrap"
              >
                <Sparkles className="w-3 h-3" />
                Launch Shield
              </Button>
            )}

            {shieldState === 'launching' && (
              <Button disabled size="sm"
                className="h-8 px-3 rounded-xl text-[9px] font-black uppercase tracking-widest bg-violet-600/60 text-violet-300 gap-1.5 whitespace-nowrap cursor-not-allowed">
                <Loader2 className="w-3 h-3 animate-spin" />
                Launching…
              </Button>
            )}

            {shieldState === 'active' && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-500/10 border border-violet-500/20">
                <ShieldCheck className="w-3 h-3 text-violet-400 shrink-0" />
                <span className="text-[9px] font-black uppercase tracking-widest text-violet-400">
                  Shield Active
                </span>
              </div>
            )}

            {shieldState === 'error' && (
              <Button onClick={handleLaunchShield} size="sm" variant="ghost"
                className="h-8 px-3 rounded-xl text-[9px] font-black uppercase tracking-widest text-red-400 hover:bg-red-500/10 gap-1 whitespace-nowrap">
                <Sparkles className="w-3 h-3" />
                Retry Shield
              </Button>
            )}

            {/* Mark contacted */}
            {isOpen && (
              <Button variant="ghost" size="sm" disabled={!!busy}
                onClick={() => handleStatusChange('contacted')}
                className="h-7 px-2.5 rounded-lg text-[9px] font-black uppercase tracking-widest text-amber-400 hover:text-foreground hover:bg-amber-500/20 gap-1 whitespace-nowrap">
                <PhoneCall className="w-3 h-3" />
                {alert.switch_type === 'future_plan_change' ? 'Call Now' : 'Contacted'}
              </Button>
            )}

            {/* Campaign — links to /dashboard/campaigns, not the deprecated /dashboard/churn */}
            {alert.switch_type === 'future_plan_change' && isOpen && (
              <Button asChild variant="ghost" size="sm"
                className="h-7 px-2.5 rounded-lg text-[9px] font-black uppercase tracking-widest text-amber-400 hover:text-foreground hover:bg-amber-500/20 gap-1">
                <Link href="/dashboard/campaigns">
                  <ArrowLeftRight className="w-3 h-3" />Campaign
                </Link>
              </Button>
            )}

            {/* Resolve */}
            {(isOpen || isContacted || isMitigating) && (
              <Button variant="ghost" size="sm" disabled={!!busy}
                onClick={() => handleStatusChange('resolved')}
                className="h-7 px-2.5 rounded-lg text-[9px] font-black uppercase tracking-widest text-emerald-400 hover:text-foreground hover:bg-emerald-500/20 gap-1">
                <CheckCircle2 className="w-3 h-3" />Resolve
              </Button>
            )}

            {/* False Alarm */}
            {isActionable && (
              <Button variant="ghost" size="sm" disabled={!!busy}
                onClick={handleFalseAlarm}
                className="h-7 px-2.5 rounded-lg text-[9px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground hover:bg-muted/50 gap-1">
                <Flag className="w-3 h-3" />False Alarm
              </Button>
            )}

            <Link href={`/dashboard/alerts/${alert.id}`}>
              <Button variant="ghost" size="sm"
                className="h-7 px-2 rounded-lg text-[9px] font-black uppercase tracking-widest text-muted-foreground hover:text-primary gap-1">
                Details <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Inline AI script preview */}
      {shieldState === 'active' && scriptPreview && (
        <div className="mx-4 mb-4 p-3 rounded-xl bg-violet-500/5 border border-violet-500/15 space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse shrink-0" />
            <p className="text-[9px] font-black uppercase tracking-widest text-violet-400">
              Maya AI · Outreach Draft Ready
            </p>
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-3">
            {scriptPreview}
          </p>
          <Link href={`/dashboard/scripts?alertId=${alert.id}`}>
            <Button variant="ghost" size="sm"
              className="h-6 px-0 text-[9px] font-black uppercase tracking-widest text-violet-400 hover:text-violet-300 gap-1">
              View Full Script <ArrowRight className="w-3 h-3" />
            </Button>
          </Link>
        </div>
      )}
    </Card>
  )
}

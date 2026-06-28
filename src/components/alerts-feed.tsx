'use client'

import { useState, useEffect } from 'react'
import { CheckCircle2, AlertTriangle, XCircle, ShieldCheck, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  AlertCard,
  type AlertRow,
  type AlertStatus,
  type AlertTypology,
  getAlertTypology,
  TYPOLOGY_CFG,
} from '@/components/alert-card'

// ── Filter types ──────────────────────────────────────────────────────────────

type TypologyFilter = 'all' | AlertTypology
type TimeFilter     = 'today' | 'week' | 'all'

interface Props {
  initialAlerts: AlertRow[]
  agencyId: string
  isStaff?: boolean
}

// ── Push notification helpers ─────────────────────────────────────────────────

function requestPushPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission === 'default') Notification.requestPermission()
}

function firePushNotification(title: string, body: string) {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  new Notification(title, { body, icon: '/icon.svg' })
}

// ── Stat chip ─────────────────────────────────────────────────────────────────

function StatChip({
  typology,
  count,
  isActive,
  onClick,
}: {
  typology: AlertTypology
  count: number
  isActive: boolean
  onClick: () => void
}) {
  const cfg  = TYPOLOGY_CFG[typology]
  const Icon = cfg.icon

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 rounded-2xl border p-4 text-left transition-all space-y-2 cursor-pointer',
        isActive
          ? typology === 'flight_risk' ? 'bg-amber-500/10 border-amber-500/30'
            : typology === 'switched'  ? 'bg-rose-500/10 border-rose-500/30'
            : 'bg-emerald-500/10 border-emerald-500/30'
          : 'bg-card border-border hover:border-border/80 hover:bg-muted/20'
      )}
    >
      <div className="flex items-center gap-2">
        <div className={cn(
          'w-6 h-6 rounded-lg flex items-center justify-center',
          typology === 'flight_risk' ? 'bg-amber-500/10'
          : typology === 'switched'  ? 'bg-rose-500/10'
          : 'bg-emerald-500/10'
        )}>
          <Icon className={cn(
            'w-3.5 h-3.5',
            typology === 'flight_risk' ? 'text-amber-400'
            : typology === 'switched'  ? 'text-rose-400'
            : 'text-emerald-400'
          )} />
        </div>
        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
          {cfg.label}
        </p>
      </div>
      <p className={cn(
        'text-3xl font-black tabular-nums leading-none',
        typology === 'flight_risk' ? 'text-amber-400'
        : typology === 'switched'  ? 'text-rose-400'
        : 'text-emerald-400'
      )}>
        {count}
      </p>
    </button>
  )
}

// ── Feed ──────────────────────────────────────────────────────────────────────

export function AlertsFeed({ initialAlerts, agencyId, isStaff }: Props) {
  const [alerts,       setAlerts]       = useState<AlertRow[]>(initialAlerts)
  const [typFilter,    setTypFilter]    = useState<TypologyFilter>('all')
  const [timeFilter,   setTimeFilter]   = useState<TimeFilter>('all')
  const [search,       setSearch]       = useState('')
  const { toast }                       = useToast()

  useEffect(() => { requestPushPermission() }, [])

  // ── Realtime subscription ─────────────────────────────────────────────────
  useEffect(() => {
    const supabase = createClient()
    const channel  = supabase
      .channel('switch_alerts_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'switch_alerts', filter: `agency_id=eq.${agencyId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const raw      = payload.new as AlertRow
            const incoming: AlertRow = {
              ...raw,
              member_full_name: null,
              member_plan:      raw.previous_value,
              carrier_display:  raw.carrier,
            }
            setAlerts(prev => [incoming, ...prev])
            const name    = incoming.member_full_name ?? 'A member'
            const carrier = incoming.carrier_display  ?? incoming.carrier ?? 'Unknown Carrier'
            toast({
              title:       '⚠️ New Switch Alert',
              description: `${name} may have switched plans — ${carrier}`,
              variant:     'destructive',
            })
            firePushNotification('New Switch Alert — AegisSage', `${name} may have left ${carrier}`)
          } else if (payload.eventType === 'UPDATE') {
            setAlerts(prev => prev.map(a => a.id === payload.new.id ? { ...a, ...payload.new } : a))
          }
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [agencyId, toast])

  // ── Handlers ─────────────────────────────────────────────────────────────
  function handleStatusChange(alertId: string, status: AlertStatus) {
    setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, status } : a))
  }
  function handleFalseAlarm(alertId: string) {
    setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, status: 'dismissed' } : a))
  }

  // ── Derived counts ────────────────────────────────────────────────────────
  const now     = Date.now()
  const DAY_MS  = 86_400_000
  const WEEK_MS = 7 * DAY_MS

  const flightRiskCount = alerts.filter(a => getAlertTypology(a) === 'flight_risk').length
  const switchedCount   = alerts.filter(a => getAlertTypology(a) === 'switched').length
  const securedCount    = alerts.filter(a => getAlertTypology(a) === 'secured').length

  // ── Filtering ─────────────────────────────────────────────────────────────
  const filtered = alerts.filter(a => {
    // Typology filter
    if (typFilter !== 'all' && getAlertTypology(a) !== typFilter) return false

    // Time filter
    if (timeFilter === 'today') {
      if (now - new Date(a.detected_at ?? 0).getTime() > DAY_MS)  return false
    } else if (timeFilter === 'week') {
      if (now - new Date(a.detected_at ?? 0).getTime() > WEEK_MS) return false
    }

    // Search
    if (search) {
      const q = search.toLowerCase()
      return (
        (a.member_full_name ?? '').toLowerCase().includes(q) ||
        (a.carrier_display  ?? a.carrier ?? '').toLowerCase().includes(q) ||
        (a.member_plan      ?? '').toLowerCase().includes(q)
      )
    }

    return true
  })

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* ── Operational state chips — three typologies ─────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <StatChip
          typology="flight_risk"
          count={flightRiskCount}
          isActive={typFilter === 'flight_risk'}
          onClick={() => setTypFilter(t => t === 'flight_risk' ? 'all' : 'flight_risk')}
        />
        <StatChip
          typology="switched"
          count={switchedCount}
          isActive={typFilter === 'switched'}
          onClick={() => setTypFilter(t => t === 'switched' ? 'all' : 'switched')}
        />
        <StatChip
          typology="secured"
          count={securedCount}
          isActive={typFilter === 'secured'}
          onClick={() => setTypFilter(t => t === 'secured' ? 'all' : 'secured')}
        />
      </div>

      {/* ── Filter bar ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">

        {/* Typology filter pills */}
        <div className="flex items-center gap-1 bg-card border border-border rounded-xl p-1">
          {([
            ['all',         `All (${alerts.length})`],
            ['flight_risk', `Flight Risk (${flightRiskCount})`],
            ['switched',    `Switched (${switchedCount})`],
            ['secured',     `Secured (${securedCount})`],
          ] as [TypologyFilter, string][]).map(([f, label]) => (
            <button
              key={f}
              onClick={() => setTypFilter(f)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-colors',
                typFilter === f
                  ? f === 'flight_risk' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    : f === 'switched'  ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    : f === 'secured'   ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-primary/20 text-primary border border-primary/30'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Time filter pills */}
        <div className="flex items-center gap-1 bg-card border border-border rounded-xl p-1">
          {([
            ['today', 'Today'],
            ['week',  'This Week'],
            ['all',   'All Time'],
          ] as [TimeFilter, string][]).map(([f, label]) => (
            <button
              key={f}
              onClick={() => setTimeFilter(f)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-colors',
                timeFilter === f
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="ml-auto flex items-center gap-2 bg-card border border-border rounded-xl px-3 h-9">
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            type="text"
            placeholder="Search member, carrier…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-full w-48 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
      </div>

      {/* ── Alert feed ──────────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <CheckCircle2 className="w-10 h-10 text-emerald-500/30" />
          <p className="text-sm font-black uppercase tracking-tight text-muted-foreground">
            No alerts match this filter
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(alert => (
            <AlertCard
              key={alert.id}
              alert={alert}
              isStaff={isStaff}
              onStatusChange={handleStatusChange}
              onFalseAlarm={handleFalseAlarm}
            />
          ))}
        </div>
      )}
    </div>
  )
}

'use client'

/**
 * TeamManagement — Premium Seat & Role Management UI
 *
 * Seat enforcement flow:
 *   1. Mount → GET /api/team/seat-check → render utilization bar
 *   2. "Invite Broker" click → POST /api/team/seat-check
 *        200 → open invite modal
 *        402 → open upgrade modal (Solo Plan cap reached)
 *   3. After invite/remove → re-fetch seat status to sync the bar
 *
 * Role visual hierarchy:
 *   agency_owner   → Amber  crown      "Owner"
 *   agency_admin   → Blue   shield     "Manager"
 *   customer_service → Slate headset  "CS"
 *   broker / solo_broker → Emerald    "Broker"
 */

import { useState, useEffect, useCallback } from 'react'
import Link   from 'next/link'
import {
  Users, UserPlus, Trash2, RefreshCw, ShieldCheck, Crown,
  Headphones, CheckCircle2, Clock, AlertTriangle, ArrowRight,
  Building2, Zap, X, Send, ChevronRight, Lock,
} from 'lucide-react'
import { Button }   from '@/components/ui/button'
import { Badge }    from '@/components/ui/badge'
import { Input }    from '@/components/ui/input'
import { Label }    from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast }    from '@/hooks/use-toast'
import { cn }       from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Broker {
  id:            string
  user_id:       string
  first_name:    string
  last_name:     string
  email:         string | null
  role:          string
  npn:           string | null
  created_at:    string
  assignedCount: number
}

interface PendingInvite {
  id:         string
  email:      string
  role:       string
  created_at: string
  expires_at: string
}

interface SeatStatus {
  currentSeats:  number
  includedSeats: number
  maxSeats:      number | null
  overageSeats:  number
  overageBilled: boolean
  tier:          'broker' | 'agency' | 'trial' | 'unknown'
  canAddSeat:    boolean
  userMessage?:  string
}

interface Props {
  brokers:        Broker[]
  agencyId:       string
  isOwner:        boolean
  pendingInvites: PendingInvite[]
  agencyTier?:    string
}

// ── Role config ────────────────────────────────────────────────────────────────

function getRoleConfig(role: string) {
  switch (role) {
    case 'agency_owner':
      return { label: 'Owner',   color: 'text-amber-400',   bg: 'bg-amber-400/10 border-amber-500/20',  Icon: Crown }
    case 'agency_admin':
      return { label: 'Manager', color: 'text-primary',     bg: 'bg-primary/10 border-primary/20',      Icon: ShieldCheck }
    case 'customer_service':
      return { label: 'CS',      color: 'text-slate-400',   bg: 'bg-slate-700/40 border-slate-600/20',  Icon: Headphones }
    case 'solo_broker':
      return { label: 'Broker',  color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', Icon: Users }
    default:
      return { label: 'Broker',  color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', Icon: Users }
  }
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

function isExpired(expires_at: string) {
  return new Date(expires_at) < new Date()
}

// ── Seat Utilization Bar ──────────────────────────────────────────────────────

function SeatUtilizationBar({ status, onInvite, isOwner }: { status: SeatStatus | null; onInvite: () => void; isOwner: boolean }) {
  if (!status) {
    return (
      <div className="h-[68px] rounded-2xl bg-slate-900 border border-slate-800 animate-pulse" />
    )
  }

  const { currentSeats, includedSeats, maxSeats, tier, overageSeats, overageBilled, canAddSeat, userMessage } = status
  // Agency owners always bypass the Solo Plan single-seat restriction banner
  const isSolo      = tier === 'broker' && !isOwner
  const pct         = maxSeats ? Math.min(100, (currentSeats / maxSeats) * 100) : Math.min(100, (currentSeats / includedSeats) * 100)
  const atLimit     = !canAddSeat
  const nearLimit   = !atLimit && currentSeats >= includedSeats - 1

  return (
    <div className={cn(
      'rounded-2xl border px-5 py-4 flex items-center gap-5',
      atLimit
        ? 'bg-amber-500/[0.06] border-amber-500/20'
        : nearLimit
          ? 'bg-slate-900 border-slate-700'
          : 'bg-slate-900 border-slate-800'
    )}>
      {/* Icon */}
      <div className={cn(
        'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
        atLimit ? 'bg-amber-400/10' : 'bg-primary/10'
      )}>
        {atLimit
          ? <Lock className="w-4.5 h-4.5 text-amber-400" />
          : <Users className="w-4.5 h-4.5 text-primary" />
        }
      </div>

      {/* Text + bar */}
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">
            {isSolo ? 'Solo Plan · 1 Seat Limit' : `Agency Plan · ${includedSeats} Seats Included`}
          </p>
          <span className={cn(
            'text-[11px] font-black tabular-nums',
            atLimit ? 'text-amber-300' : 'text-white'
          )}>
            {currentSeats} / {maxSeats ?? includedSeats}
            {overageSeats > 0 && (
              <span className="text-slate-500 font-medium ml-1">+{overageSeats} overage</span>
            )}
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              atLimit ? 'bg-amber-400' : pct > 80 ? 'bg-amber-400' : 'bg-primary'
            )}
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Sub-label */}
        {userMessage ? (
          <p className="text-[9px] font-bold text-amber-400/80 uppercase tracking-wider">{userMessage}</p>
        ) : overageBilled && overageSeats > 0 ? (
          <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">
            +${overageSeats * 49}/mo overage · reconciles on next invoice
          </p>
        ) : isSolo && atLimit ? (
          <p className="text-[9px] font-bold text-amber-400/80 uppercase tracking-wider">
            Upgrade to Agency Plan to add team members
          </p>
        ) : null}
      </div>

      {/* Invite CTA inside the bar (desktop only) */}
      <button
        onClick={onInvite}
        className={cn(
          'hidden md:flex items-center gap-1.5 h-8 px-3 rounded-xl text-[9px] font-black uppercase tracking-widest',
          'border transition-all duration-150 shrink-0',
          atLimit
            ? 'bg-amber-400/10 text-amber-300 border-amber-500/30 hover:bg-amber-400/20'
            : 'bg-primary/10 text-primary border-primary/20 hover:bg-primary/20'
        )}
      >
        {atLimit ? 'Upgrade Plan' : 'Add Seat'}
        <ChevronRight className="w-3 h-3" />
      </button>
    </div>
  )
}

// ── Upgrade Modal ─────────────────────────────────────────────────────────────

function UpgradeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="rounded-3xl border-slate-700 bg-slate-950 sm:max-w-md p-0 overflow-hidden">

        {/* Header gradient */}
        <div className="bg-gradient-to-br from-primary/20 via-violet-600/10 to-transparent border-b border-white/[0.07] px-8 pt-8 pb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-11 h-11 rounded-2xl bg-primary/15 border border-primary/25 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-primary/70">Seat Limit Reached</p>
              <h2 className="text-lg font-black text-white tracking-tight">Solo Plan · 1 Seat Only</h2>
            </div>
          </div>
          <p className="text-sm text-white/50 font-medium leading-relaxed">
            Your Solo Broker Plan allows one broker seat. Upgrade to the Agency Plan
            to add team members and unlock the Silent Owner Master Dashboard.
          </p>
        </div>

        {/* Agency Plan feature list */}
        <div className="px-8 py-6 space-y-5">
          <div className="space-y-2.5">
            {[
              { icon: Users,      text: '5 broker seats included — no overage on first 5' },
              { icon: ShieldCheck, text: 'Silent Owner Master Dashboard — full downline visibility' },
              { icon: Building2,  text: 'GoHighLevel multi-sub-account routing per broker' },
              { icon: CheckCircle2, text: 'Agency-wide compliance_audit_logs export' },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-start gap-2.5">
                <Icon className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                <span className="text-[11px] font-medium text-slate-300">{text}</span>
              </div>
            ))}
          </div>

          {/* Price display */}
          <div className="rounded-2xl bg-[hsl(var(--surface-2))] border border-white/[0.06] px-4 py-3 flex items-baseline justify-between">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Agency Plan</span>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-black text-white tabular-nums">$749</span>
              <span className="text-[10px] font-bold text-slate-500">/mo · 5 seats</span>
            </div>
          </div>
          <p className="text-[9px] font-bold text-slate-600 uppercase tracking-wider text-center">
            Annual plan: $599/mo · Save $1,800/yr · Extra seats +$49/seat/mo
          </p>

          {/* CTAs */}
          <div className="flex gap-3 pt-1">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 h-10 rounded-2xl text-[10px] font-black uppercase tracking-widest border-slate-700 text-slate-400 hover:text-white hover:border-slate-500"
            >
              Not Now
            </Button>
            <Button asChild className="flex-1 h-10 rounded-2xl text-[10px] font-black uppercase tracking-widest bg-primary hover:bg-primary/90 gap-1.5">
              <Link href="/dashboard/billing">
                Deploy Agency-Wide <ArrowRight className="w-3 h-3" />
              </Link>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Invite Modal ──────────────────────────────────────────────────────────────

function InviteModal({
  open,
  onClose,
  agencyId,
  seatStatus,
  onSuccess,
}: {
  open:       boolean
  onClose:    () => void
  agencyId:   string
  seatStatus: SeatStatus | null
  onSuccess:  (broker: Broker) => void
}) {
  const [form, setForm]       = useState({ email: '', first_name: '', last_name: '', npn: '' })
  const [role, setRole]       = useState<'broker' | 'agency_admin' | 'customer_service'>('broker')
  const [sending, setSending] = useState(false)

  const overageWarning = seatStatus?.overageBilled &&
    (seatStatus.currentSeats + 1) > seatStatus.includedSeats

  const handleInvite = async () => {
    if (!form.email || !form.first_name || !form.last_name) {
      toast({ title: 'Missing fields', description: 'Email, first name, and last name are required.', variant: 'destructive' })
      return
    }
    setSending(true)
    try {
      const res  = await fetch('/api/team/invite', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: form.email, first_name: form.first_name, last_name: form.last_name, npn: form.npn, role, agency_id: agencyId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Invite failed')
      if (json.broker) onSuccess(json.broker)
      toast({ title: 'Invite sent', description: `${form.first_name} ${form.last_name} will receive an email to join.` })
      setForm({ email: '', first_name: '', last_name: '', npn: '' })
      onClose()
    } catch (err: any) {
      toast({ title: 'Error sending invite', description: err.message, variant: 'destructive' })
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="rounded-3xl border-slate-700 bg-slate-900 sm:max-w-md">
        <DialogHeader className="pb-2">
          <DialogTitle className="font-black uppercase tracking-tight text-sm text-white flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-primary" />
            Invite a Broker
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Overage warning */}
          {overageWarning && (
            <div className="flex items-start gap-2.5 rounded-xl bg-amber-500/[0.08] border border-amber-500/20 px-3.5 py-3">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[10px] font-bold text-amber-300/90 leading-snug">
                This seat exceeds your {seatStatus?.includedSeats} included seats.
                An additional <strong>$49/mo</strong> will appear on your next invoice.
              </p>
            </div>
          )}

          {/* Name row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">First Name *</Label>
              <Input
                value={form.first_name}
                onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
                placeholder="Jane"
                className="h-10 rounded-xl bg-slate-800 border-slate-700 text-white text-sm placeholder:text-slate-600 focus:border-primary"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Last Name *</Label>
              <Input
                value={form.last_name}
                onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
                placeholder="Doe"
                className="h-10 rounded-xl bg-slate-800 border-slate-700 text-white text-sm placeholder:text-slate-600 focus:border-primary"
              />
            </div>
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Email Address *</Label>
            <Input
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="jane@agency.com"
              className="h-10 rounded-xl bg-slate-800 border-slate-700 text-white text-sm placeholder:text-slate-600 focus:border-primary"
            />
          </div>

          {/* Role + NPN row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Role</Label>
              <Select value={role} onValueChange={(v: any) => setRole(v)}>
                <SelectTrigger className="h-10 rounded-xl bg-slate-800 border-slate-700 text-white text-sm focus:border-primary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl bg-slate-800 border-slate-700">
                  <SelectItem value="broker">Broker</SelectItem>
                  <SelectItem value="agency_admin">Manager</SelectItem>
                  <SelectItem value="customer_service">CS</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">NPN <span className="text-slate-600">(optional)</span></Label>
              <Input
                value={form.npn}
                onChange={e => setForm(f => ({ ...f, npn: e.target.value }))}
                placeholder="12345678"
                className="h-10 rounded-xl bg-slate-800 border-slate-700 text-white text-sm font-mono placeholder:text-slate-600 focus:border-primary"
              />
            </div>
          </div>

          {/* Submit */}
          <div className="flex gap-3 pt-1">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 h-10 rounded-2xl text-[10px] font-black uppercase tracking-widest border-slate-700 text-slate-400 hover:text-white hover:border-slate-500"
              disabled={sending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleInvite}
              disabled={sending || !form.email || !form.first_name || !form.last_name}
              className="flex-1 h-10 rounded-2xl text-[10px] font-black uppercase tracking-widest bg-primary hover:bg-primary/90 gap-1.5"
            >
              {sending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              {sending ? 'Sending...' : 'Send Invite'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Broker Row ────────────────────────────────────────────────────────────────

function BrokerRow({
  broker,
  isOwner,
  onRemove,
  removing,
}: {
  broker:   Broker
  isOwner:  boolean
  onRemove: (b: Broker) => void
  removing: string | null
}) {
  const cfg = getRoleConfig(broker.role)
  const { Icon } = cfg
  const initials = `${broker.first_name?.charAt(0) ?? ''}${broker.last_name?.charAt(0) ?? ''}`.toUpperCase() || '?'
  const isBeingRemoved = removing === broker.id
  const isSelf = broker.role === 'agency_owner'

  const inner = (
    <>
      {/* Avatar */}
      <div className={cn(
        'w-9 h-9 rounded-xl flex items-center justify-center text-[11px] font-black shrink-0',
        cfg.bg
      )}>
        <span className={cfg.color}>{initials}</span>
      </div>

      {/* Name + email */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-[13px] font-bold text-white truncate">
            {broker.first_name} {broker.last_name}
          </p>
          <span className={cn(
            'inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-[0.12em] px-2 py-0.5 rounded-full border shrink-0',
            cfg.bg, cfg.color
          )}>
            <Icon className="w-2.5 h-2.5" />
            {cfg.label}
          </span>
        </div>
        <p className="text-[10px] text-slate-500 font-medium truncate">
          {broker.email ?? '—'}
          {broker.npn && (
            <span className="ml-2 font-mono text-slate-600">NPN: {broker.npn}</span>
          )}
        </p>
      </div>

      {/* Assigned count */}
      <div className="hidden sm:flex flex-col items-end shrink-0">
        <p className="text-[11px] font-black text-white tabular-nums">{broker.assignedCount}</p>
        <p className="text-[8px] font-bold uppercase tracking-widest text-slate-600">Clients</p>
      </div>

      {/* Joined date */}
      <div className="hidden md:flex flex-col items-end shrink-0">
        <p className="text-[10px] font-medium text-slate-500 tabular-nums">{fmtDate(broker.created_at)}</p>
        <p className="text-[8px] font-bold uppercase tracking-widest text-slate-700">Joined</p>
      </div>

      {/* Remove (owner only, not self) */}
      {isOwner && !isSelf && (
        <button
          onClick={e => { e.preventDefault(); e.stopPropagation(); onRemove(broker) }}
          disabled={isBeingRemoved}
          className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-lg flex items-center justify-center text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all duration-150 shrink-0"
        >
          {isBeingRemoved
            ? <RefreshCw className="w-3 h-3 animate-spin" />
            : <Trash2 className="w-3 h-3" />
          }
        </button>
      )}

      {/* Drill-in arrow (owner view of non-self brokers) */}
      {isOwner && !isSelf && (
        <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-primary transition-colors shrink-0" />
      )}
    </>
  )

  const rowClass = cn(
    'group flex items-center gap-4 px-5 py-3.5 border-b border-slate-800/60 last:border-0',
    'transition-colors duration-100',
    isBeingRemoved && 'opacity-50 pointer-events-none',
    isOwner && !isSelf ? 'hover:bg-slate-800/40 cursor-pointer' : 'hover:bg-slate-800/30'
  )

  // Agency owners can drill into a broker's member list via the manager page
  if (isOwner && !isSelf) {
    return (
      <Link
        href={`/dashboard/manager?brokerId=${broker.id}`}
        className={rowClass}
      >
        {inner}
      </Link>
    )
  }

  return (
    <div className={rowClass}>
      {inner}
    </div>
  )
}

// ── Pending Invite Row ────────────────────────────────────────────────────────

function InviteRow({
  invite,
  onResend,
  sending,
}: {
  invite:   PendingInvite
  onResend: (i: PendingInvite) => void
  sending:  boolean
}) {
  const expired = isExpired(invite.expires_at)
  const cfg = getRoleConfig(invite.role)

  return (
    <div className="flex items-center gap-4 px-5 py-3 border-b border-slate-800/60 last:border-0">
      {/* Status dot */}
      <div className={cn(
        'w-2 h-2 rounded-full shrink-0',
        expired ? 'bg-red-500' : 'bg-amber-400 animate-pulse'
      )} />

      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-bold text-slate-300 truncate">{invite.email}</p>
        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-600">
          {expired ? '✗ Expired' : `Expires ${fmtDate(invite.expires_at)}`}
          {' · '}{cfg.label}
        </p>
      </div>

      <button
        onClick={() => onResend(invite)}
        disabled={sending}
        className="flex items-center gap-1 h-7 px-2.5 rounded-lg text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-white border border-slate-700 hover:border-slate-500 hover:bg-slate-800 transition-all"
      >
        {sending ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : <RefreshCw className="w-2.5 h-2.5" />}
        Resend
      </button>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function TeamManagement({ brokers: initial, agencyId, isOwner, pendingInvites: initialInvites, agencyTier }: Props) {
  // Solo Broker plan ($149) has no team seats. Hide seat management UI entirely.
  // 'professional' is used by beta/test accounts and maps to agency-tier features.
  const AGENCY_TIERS_SET = new Set(['agency', 'enterprise', 'professional', 'agency_plan'])
  const isAgencyTier     = AGENCY_TIERS_SET.has(agencyTier ?? '')
  const [brokers,       setBrokers]       = useState<Broker[]>(initial)
  const [invites,       setInvites]       = useState<PendingInvite[]>(initialInvites)
  const [seatStatus,    setSeatStatus]    = useState<SeatStatus | null>(null)
  const [showInvite,    setShowInvite]    = useState(false)
  const [showUpgrade,   setShowUpgrade]   = useState(false)
  const [checking,      setChecking]      = useState(false)
  const [removing,      setRemoving]      = useState<string | null>(null)
  const [resending,     setResending]     = useState(false)

  // ── Fetch seat status ───────────────────────────────────────────────────────
  const refreshSeatStatus = useCallback(async () => {
    try {
      const res  = await fetch('/api/team/seat-check')
      if (!res.ok) return
      const data = await res.json()
      setSeatStatus(data)
    } catch { /* non-fatal */ }
  }, [])

  useEffect(() => { refreshSeatStatus() }, [refreshSeatStatus])

  // ── Invite button handler — seat check first ──────────────────────────────
  const handleInviteClick = async () => {
    setChecking(true)
    try {
      const res  = await fetch('/api/team/seat-check', { method: 'POST' })
      const data = await res.json()

      if (res.status === 402) {
        // Seat limit reached — show upgrade modal instead of invite form
        setShowUpgrade(true)
        setSeatStatus(prev => prev ? { ...prev, canAddSeat: false, userMessage: data.userMessage } : prev)
        return
      }

      if (!res.ok) {
        toast({ title: 'Seat check failed', description: data.error ?? 'Please try again.', variant: 'destructive' })
        return
      }

      // Seat available — open invite modal
      setSeatStatus(prev => prev ? { ...prev, ...data } : data)
      setShowInvite(true)
    } finally {
      setChecking(false)
    }
  }

  // ── Remove handler ─────────────────────────────────────────────────────────
  const handleRemove = async (broker: Broker) => {
    if (!confirm(`Remove ${broker.first_name} ${broker.last_name}? Their assigned contacts will be unassigned.`)) return
    setRemoving(broker.id)
    try {
      const res = await fetch(`/api/team/remove?brokerId=${broker.id}`, { method: 'DELETE' })
      if (!res.ok) { const j = await res.json(); throw new Error(j.error ?? 'Remove failed') }
      setBrokers(prev => prev.filter(b => b.id !== broker.id))
      toast({ title: 'Broker seat deactivated', description: 'Seat overage will reconcile on the next billing cycle.' })
      await refreshSeatStatus()
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
    } finally {
      setRemoving(null)
    }
  }

  // ── Resend invite ──────────────────────────────────────────────────────────
  const handleResend = async (invite: PendingInvite) => {
    setResending(true)
    try {
      const res = await fetch('/api/team/invite', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: invite.email, first_name: invite.email.split('@')[0], last_name: '', role: invite.role, agency_id: agencyId }),
      })
      if (!res.ok) { const j = await res.json(); throw new Error(j.error ?? 'Resend failed') }
      toast({ title: 'Invite resent', description: `Re-sent to ${invite.email}` })
      const newExpires = new Date(Date.now() + 7 * 86400000).toISOString()
      setInvites(prev => prev.map(i => i.id === invite.id ? { ...i, expires_at: newExpires } : i))
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
    } finally {
      setResending(false)
    }
  }

  // ── After successful invite ────────────────────────────────────────────────
  const handleInviteSuccess = async (broker: Broker) => {
    setBrokers(prev => [broker, ...prev])
    await refreshSeatStatus()
  }

  const activeCount  = brokers.length
  const pendingCount = invites.length

  return (
    <div className="flex flex-col h-full w-full bg-background overflow-y-auto">

      {/* ── Sticky Header ─────────────────────────────────────────────────── */}
      <header className="h-16 border-b border-slate-800 px-6 md:px-8 flex items-center justify-between bg-slate-950/80 backdrop-blur-md sticky top-0 z-10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Users className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h1 className="text-[15px] font-black text-white uppercase tracking-tight">Your Team</h1>
            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
              {activeCount} active · {pendingCount} pending
            </p>
          </div>
        </div>

        {isOwner && isAgencyTier && (
          <Button
            onClick={handleInviteClick}
            disabled={checking}
            className="h-9 px-4 rounded-xl font-black uppercase tracking-widest text-[10px] gap-2 bg-primary hover:bg-primary/90"
          >
            {checking
              ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              : <UserPlus className="w-3.5 h-3.5" />
            }
            {checking ? 'Checking...' : 'Invite Broker'}
          </Button>
        )}
      </header>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 p-6 md:p-8 space-y-6 max-w-4xl mx-auto w-full">

        {/* Seat utilization bar — only for Agency Plan owners.
            Solo Broker plan has exactly 1 seat; the bar is meaningless and
            showing '2/1 used' caused visible confusion in the broker view. */}
        {isOwner && isAgencyTier && (
          <SeatUtilizationBar
            status={seatStatus}
            onInvite={handleInviteClick}
            isOwner={isOwner}
          />
        )}

        {/* ── Active Seats ─────────────────────────────────────────────── */}
        <div className="rounded-3xl border border-slate-800 overflow-hidden bg-slate-900/50">
          <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <p className="text-[11px] font-black uppercase tracking-widest text-white">Active Seats</p>
              <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 font-black text-[9px] px-2">
                {activeCount}
              </Badge>
            </div>
            {seatStatus && (
              <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest hidden sm:block">
                {seatStatus.tier === 'broker' ? 'Solo Plan · 1 seat max' : `Agency Plan · ${seatStatus.includedSeats} included`}
              </p>
            )}
          </div>

          {brokers.length === 0 ? (
            <div className="py-12 flex flex-col items-center gap-3 text-center px-6">
              <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center">
                <Users className="w-5 h-5 text-slate-600" />
              </div>
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-600">No Active Seats</p>
              {isOwner && (
                <button onClick={handleInviteClick} className="text-[10px] font-bold text-primary hover:underline">
                  Invite your first broker →
                </button>
              )}
            </div>
          ) : (
            brokers.map(broker => (
              <BrokerRow
                key={broker.id}
                broker={broker}
                isOwner={isOwner}
                onRemove={handleRemove}
                removing={removing}
              />
            ))
          )}
        </div>

        {/* ── Pending Invites ───────────────────────────────────────────── */}
        {(invites.length > 0 || isOwner) && (
          <div className="rounded-3xl border border-slate-800 overflow-hidden bg-slate-900/50">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400" />
              <p className="text-[11px] font-black uppercase tracking-widest text-white">Pending Invites</p>
              {pendingCount > 0 && (
                <Badge className="bg-amber-400/10 text-amber-400 border-amber-500/20 font-black text-[9px] px-2">
                  {pendingCount}
                </Badge>
              )}
            </div>

            {invites.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-[10px] font-bold text-slate-700 uppercase tracking-widest">No pending invites</p>
              </div>
            ) : (
              invites.map(invite => (
                <InviteRow
                  key={invite.id}
                  invite={invite}
                  onResend={handleResend}
                  sending={resending}
                />
              ))
            )}
          </div>
        )}

        {/* ── Compliance footnote ───────────────────────────────────────── */}
        <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-700 text-center pb-4 font-mono">
          All seat changes are logged immutably to compliance_audit_logs · Broker data is isolated per seat · HIPAA §164.312(b)
        </p>
      </div>

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      {/* Upgrade modal only relevant for Agency Plan — never show to Solo Broker tier */}
      {isAgencyTier && (
        <UpgradeModal
          open={showUpgrade}
          onClose={() => setShowUpgrade(false)}
        />
      )}
      <InviteModal
        open={showInvite}
        onClose={() => setShowInvite(false)}
        agencyId={agencyId}
        seatStatus={seatStatus}
        onSuccess={handleInviteSuccess}
      />
    </div>
  )
}

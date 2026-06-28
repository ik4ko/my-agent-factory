"use client"

/**
 * BillingLifecyclePanel
 *
 * Agency Owner settings panel for subscription lifecycle management.
 * Renders in /dashboard/settings under a "Danger Zone" section.
 *
 * Three actions:
 *  1. Pause Account    — suspends billing, retains all data
 *  2. Cancel Payments  — schedules cancellation at period end
 *  3. Delete Account   — immediate soft-delete, permanent lockout
 *
 * Each action requires an inline confirmation step before firing the API.
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PauseCircle, XCircle, Trash2, AlertTriangle, ChevronDown, ChevronUp, RefreshCw, Undo2 } from 'lucide-react'

type LifecycleStatus = 'active' | 'paused' | 'cancel_scheduled' | 'cancelled' | 'deleted' | 'trial' | 'past_due' | string

interface BillingLifecyclePanelProps {
  currentStatus:    LifecycleStatus
  currentPeriodEnd: string | null
  agencyName:       string
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: LifecycleStatus }) {
  const map: Record<string, { label: string; cls: string }> = {
    active:           { label: 'Active',             cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
    trial:            { label: 'Trial',              cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
    paused:           { label: 'Paused',             cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
    cancel_scheduled: { label: 'Cancels at Period End', cls: 'bg-orange-500/10 text-orange-400 border-orange-500/20' },
    past_due:         { label: 'Past Due',           cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
    cancelled:        { label: 'Cancelled',          cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
    deleted:          { label: 'Deleted',            cls: 'bg-red-900/30 text-red-400 border-red-900/40' },
  }
  const s = map[status] ?? { label: status, cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20' }
  return (
    <Badge className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1 border ${s.cls}`}>
      {s.label}
    </Badge>
  )
}

// ── Action card ───────────────────────────────────────────────────────────────
function ActionCard({
  icon: Icon,
  title,
  description,
  buttonLabel,
  buttonClass,
  confirmLabel,
  confirmPlaceholder,
  requiresTypedConfirm,
  onConfirm,
  disabled,
  loading,
  accentClass,
}: {
  icon:                 React.ElementType
  title:                string
  description:          string
  buttonLabel:          string
  buttonClass:          string
  confirmLabel:         string
  confirmPlaceholder:   string
  requiresTypedConfirm: boolean
  onConfirm:            (typed: string) => Promise<void>
  disabled:             boolean
  loading:              boolean
  accentClass:          string
}) {
  const [expanded,  setExpanded]  = useState(false)
  const [typed,     setTyped]     = useState('')
  const [localLoad, setLocalLoad] = useState(false)

  const handleConfirm = async () => {
    setLocalLoad(true)
    try {
      await onConfirm(typed)
      setExpanded(false)
      setTyped('')
    } finally {
      setLocalLoad(false)
    }
  }

  const canConfirm = requiresTypedConfirm
    ? typed.trim().toUpperCase() === confirmPlaceholder.toUpperCase()
    : true

  return (
    <div className={`rounded-2xl border bg-slate-900 ${accentClass} overflow-hidden`}>
      <button
        onClick={() => !disabled && setExpanded(e => !e)}
        disabled={disabled}
        className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-white/[0.02] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <div className="flex items-center gap-3">
          <Icon className="w-4 h-4 text-slate-400 shrink-0" />
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-200">{title}</p>
            <p className="text-[10px] font-medium text-slate-500 mt-0.5">{description}</p>
          </div>
        </div>
        {expanded
          ? <ChevronUp className="w-4 h-4 text-slate-600" />
          : <ChevronDown className="w-4 h-4 text-slate-600" />
        }
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-3 border-t border-white/5 pt-4">
          <p className="text-[10px] font-bold text-slate-400">{confirmLabel}</p>

          {requiresTypedConfirm && (
            <input
              type="text"
              value={typed}
              onChange={e => setTyped(e.target.value)}
              placeholder={confirmPlaceholder}
              className="w-full h-10 rounded-xl bg-white/5 border border-white/10 text-white text-sm px-3 placeholder:text-white/20 focus:outline-none focus:border-red-500/50 font-mono tracking-wide"
            />
          )}

          <div className="flex gap-2">
            <Button
              onClick={handleConfirm}
              disabled={!canConfirm || localLoad || loading}
              className={`flex-1 h-10 rounded-xl font-black uppercase text-[10px] tracking-widest ${buttonClass}`}
            >
              {localLoad || loading
                ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                : buttonLabel
              }
            </Button>
            <Button
              onClick={() => { setExpanded(false); setTyped('') }}
              variant="ghost"
              className="h-10 rounded-xl font-black uppercase text-[10px] tracking-widest text-slate-500 hover:text-slate-300 hover:bg-white/5"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────
export function BillingLifecyclePanel({
  currentStatus,
  currentPeriodEnd,
  agencyName,
}: BillingLifecyclePanelProps) {
  const [status,    setStatus]    = useState<LifecycleStatus>(currentStatus)
  const [periodEnd, setPeriodEnd] = useState<string | null>(currentPeriodEnd)
  const [error,     setError]     = useState<string | null>(null)
  const [loading,   setLoading]   = useState(false)

  const callApi = async (endpoint: string, method = 'POST', body?: object) => {
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`/api/billing/${endpoint}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      const json = await res.json() as {
        success?: boolean; status?: string; error?: string;
        current_period_end?: string; message?: string
      }
      if (!res.ok) {
        setError(json.error ?? 'An error occurred')
        return false
      }
      if (json.status)           setStatus(json.status as LifecycleStatus)
      if (json.current_period_end) setPeriodEnd(json.current_period_end)
      return true
    } catch {
      setError('Network error — please try again')
      return false
    } finally {
      setLoading(false)
    }
  }

  const isPaused           = status === 'paused'
  const isCancelScheduled  = status === 'cancel_scheduled'
  const isTerminated       = status === 'cancelled' || status === 'deleted'

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-300">
            Subscription Lifecycle
          </h3>
          <p className="text-[10px] font-medium text-slate-500 mt-0.5">
            Manage billing status for <span className="text-slate-300 font-bold">{agencyName}</span>
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Period end info */}
      {(isCancelScheduled || status === 'active') && periodEnd && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-slate-800 border border-white/5">
          <div className="w-1.5 h-1.5 rounded-full bg-slate-500" />
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            {isCancelScheduled
              ? `Access ends ${new Date(periodEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
              : `Current period ends ${new Date(periodEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
            }
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-red-500/10 border border-red-500/20">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
          <p className="text-[10px] font-bold text-red-400">{error}</p>
        </div>
      )}

      {/* Undo cancel */}
      {isCancelScheduled && (
        <div className="flex items-center justify-between px-4 py-3 rounded-2xl bg-orange-500/5 border border-orange-500/20">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-orange-400">Cancellation Scheduled</p>
            <p className="text-[9px] font-medium text-slate-500 mt-0.5">Your subscription will end at the current period.</p>
          </div>
          <Button
            onClick={() => callApi('cancel', 'DELETE')}
            disabled={loading}
            size="sm"
            variant="outline"
            className="rounded-xl h-8 font-black uppercase text-[9px] tracking-widest border-orange-500/30 text-orange-400 hover:bg-orange-500/10"
          >
            <Undo2 className="w-3 h-3 mr-1" /> Undo
          </Button>
        </div>
      )}

      {/* Pause */}
      {!isPaused && !isTerminated && (
        <ActionCard
          icon={PauseCircle}
          title="Pause Account"
          description="Suspend billing. All data retained. Operations locked until resumed."
          buttonLabel="Confirm Pause"
          buttonClass="bg-amber-600 hover:bg-amber-700 text-white"
          confirmLabel="Pausing will suspend all broker access and billing. Your data is fully retained."
          confirmPlaceholder=""
          requiresTypedConfirm={false}
          accentClass="border-amber-500/20"
          disabled={loading}
          loading={loading}
          onConfirm={async () => { await callApi('pause') }}
        />
      )}

      {/* Resume (when paused) */}
      {isPaused && (
        <div className="flex items-center justify-between px-4 py-3 rounded-2xl bg-amber-500/5 border border-amber-500/20">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-400">Account Paused</p>
            <p className="text-[9px] font-medium text-slate-500 mt-0.5">Contact support to resume billing.</p>
          </div>
          <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[9px] font-black uppercase tracking-widest">
            Paused
          </Badge>
        </div>
      )}

      {/* Cancel at period end */}
      {!isCancelScheduled && !isTerminated && (
        <ActionCard
          icon={XCircle}
          title="Cancel Payments"
          description="No more charges. Account stays active until current period ends."
          buttonLabel="Schedule Cancellation"
          buttonClass="bg-orange-600 hover:bg-orange-700 text-white"
          confirmLabel="Your subscription will not renew. You retain full access until the period ends."
          confirmPlaceholder=""
          requiresTypedConfirm={false}
          accentClass="border-orange-500/20"
          disabled={loading}
          loading={loading}
          onConfirm={async () => { await callApi('cancel') }}
        />
      )}

      {/* Delete */}
      {!isTerminated && (
        <ActionCard
          icon={Trash2}
          title="Delete Account"
          description="Permanent. Immediate access revocation. Data retained for HIPAA compliance."
          buttonLabel="Permanently Delete"
          buttonClass="bg-red-600 hover:bg-red-700 text-white"
          confirmLabel={`This is irreversible. Type DELETE MY ACCOUNT to confirm.`}
          confirmPlaceholder="DELETE MY ACCOUNT"
          requiresTypedConfirm={true}
          accentClass="border-red-500/20"
          disabled={loading}
          loading={loading}
          onConfirm={async () => {
            await callApi('delete', 'POST', { confirm: 'DELETE MY ACCOUNT' })
          }}
        />
      )}

      {/* Terminated state */}
      {isTerminated && (
        <div className="px-5 py-4 rounded-2xl bg-slate-800 border border-white/5 text-center space-y-1">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Account Terminated</p>
          <p className="text-[10px] font-medium text-slate-600">Contact support@aegissage.com to discuss reactivation.</p>
        </div>
      )}

      {/* HIPAA retention note */}
      <p className="text-[9px] font-bold text-slate-700 uppercase tracking-widest text-center pt-1">
        All data retained per CMS 10-year HIPAA audit requirements
      </p>
    </div>
  )
}

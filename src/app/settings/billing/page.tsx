'use client'

import { useEffect, useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  CreditCard, ExternalLink, CheckCircle2, AlertTriangle,
  XCircle, RefreshCw, ArrowUpRight, Clock, Building2, Lock, Users, User,
} from 'lucide-react'
import Link from 'next/link'
import { getCancelUrl } from '@/app/actions/billing'
import { BillingLifecyclePanel } from '@/components/settings/BillingLifecyclePanel'
import { cn } from '@/lib/utils'

type BillingCycle = 'monthly' | 'yearly'

// Yearly pricing (17% discount)
const AGENCY_MONTHLY  = 749
const AGENCY_YEARLY   = 622   // per month, billed $7,464/yr
const BROKER_MONTHLY  = 149
const BROKER_YEARLY   = 124   // per month, billed $1,488/yr

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * billingCase derivation (single source of truth):
 *
 *   'owner_agency'  → user owns an agency on agency/professional/enterprise tier
 *                     Shows $749/mo dashboard with live seat metrics
 *
 *   'owner_broker'  → user owns an agency on broker/solo tier
 *                     Shows $149/mo card with renewal date + cancel button
 *
 *   'sub_broker'    → user is a broker under someone else's agency
 *                     Read-only view — billing managed by owner
 */
type BillingCase = 'owner_agency' | 'owner_broker' | 'sub_broker' | null

interface AgencyData {
  id:                    string
  name?:                 string | null
  subscription_status?:  string | null
  subscription_tier?:    string | null
  stripe_customer_id?:   string | null
  stripe_subscription_id?: string | null
  current_period_end?:   string | null
  is_beta?:              boolean | null
}

const AGENCY_TIERS = ['agency', 'professional', 'enterprise', 'agency_plan']

const STATUS_CFG: Record<string, { label: string; icon: typeof CheckCircle2; cls: string }> = {
  active:    { label: 'Active',    icon: CheckCircle2,  cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  beta:      { label: 'Beta',      icon: CheckCircle2,  cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  past_due:  { label: 'Past Due',  icon: AlertTriangle, cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  cancelled: { label: 'Cancelled', icon: XCircle,       cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
  trial:     { label: 'Trial',     icon: Clock,         cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
}

function fmtDate(d: string | null | undefined) {
  if (!d) return null
  return new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function PageHeader({ subtitle }: { subtitle: string }) {
  return (
    <header className="h-16 border-b border-border px-8 flex items-center gap-3 bg-card/50 backdrop-blur-md sticky top-0 z-10">
      <div className="w-9 h-9 rounded-2xl bg-primary/10 flex items-center justify-center">
        <CreditCard className="w-4 h-4 text-primary" />
      </div>
      <div>
        <h1 className="text-lg font-black text-foreground uppercase tracking-tight">Plan &amp; Billing</h1>
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{subtitle}</p>
      </div>
    </header>
  )
}

function CancelledBanner({ endDate }: { endDate?: string | null }) {
  return (
    <div className="rounded-2xl bg-amber-500/10 border border-amber-500/20 px-5 py-4">
      <p className="text-amber-400 text-sm font-bold">Your subscription has been cancelled.</p>
      {endDate && (
        <p className="text-amber-300/70 text-xs mt-1">
          Access continues until {fmtDate(endDate)}.
        </p>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BillingPage() {
  const [billingCase, setBillingCase] = useState<BillingCase>(null)
  const [agency,      setAgency]      = useState<AgencyData | null>(null)
  const [ownerAgencyName, setOwnerAgencyName] = useState<string | null>(null)
  // live active seat count from DB (agency owners only)
  const [activeSeats,  setActiveSeats]  = useState(0)
  const [includedSeats, setIncludedSeats] = useState(5)
  const [loading,      setLoading]      = useState(true)
  const [showCancelled, setShowCancelled] = useState(false)

  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly')

  const [portalPending,  startPortal]  = useTransition()
  const [cancelPending,  startCancel]  = useTransition()
  const [upgradePending, startUpgrade] = useTransition()
  const [upgradingPlan,  setUpgradingPlan] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('cancelled=true')) {
      setShowCancelled(true)
    }
    // Load billing cycle preference from localStorage (display-only; no Stripe changes)
    // NOTE: billing_cycle column does not yet exist in agencies table — localStorage only
    const saved = localStorage.getItem('billing_cycle') as BillingCycle | null
    if (saved === 'monthly' || saved === 'yearly') setBillingCycle(saved)
  }, [])

  useEffect(() => {
    ;(async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const [{ data: ag }, { data: brokerRow }] = await Promise.all([
        supabase
          .from('agencies')
          .select('id, name, subscription_status, subscription_tier, stripe_customer_id, stripe_subscription_id, current_period_end, is_beta, seat_limit, included_seats')
          .eq('owner_id', user.id)
          .maybeSingle(),
        supabase
          .from('brokers')
          .select('id, role, agency_id')
          .eq('user_id', user.id)
          .maybeSingle(),
      ])

      if (ag) {
        // ── User owns this agency ─────────────────────────────────────────
        setAgency(ag)
        const tier = ag.subscription_tier ?? ''
        const roleIsAgencyOwner = brokerRow?.role === 'agency_owner'
        // subscription_tier is source of truth; role is fallback only when tier is missing/ambiguous
        const isAgencyAccount = AGENCY_TIERS.includes(tier) ||
          (roleIsAgencyOwner && !['broker', 'solo'].includes(tier))
        setBillingCase(isAgencyAccount ? 'owner_agency' : 'owner_broker')

        // Pull live active seat count for agency owners
        const { count } = await supabase
          .from('brokers')
          .select('id', { count: 'exact', head: true })
          .eq('agency_id', ag.id)
          .eq('is_active', true)
        setActiveSeats(count ?? 0)
        // included_seats from DB (default 5 for agency, 1 for broker)
        setIncludedSeats((ag as AgencyData & { included_seats?: number }).included_seats ?? 5)

      } else if (brokerRow?.agency_id) {
        // ── Sub-broker under someone else's agency ────────────────────────
        setBillingCase('sub_broker')
        const { data: parentAgency } = await supabase
          .from('agencies')
          .select('name, subscription_tier, subscription_status, is_beta')
          .eq('id', brokerRow.agency_id)
          .maybeSingle()
        if (parentAgency) {
          setAgency(parentAgency as AgencyData)
          setOwnerAgencyName(parentAgency.name ?? null)
        }
      } else {
        // No broker row and no owned agency — shouldn't happen post-provision
        setBillingCase('owner_broker')
      }

      setLoading(false)
    })()
  }, [])

  // ── Action handlers ───────────────────────────────────────────────────────

  const handlePortal = () => {
    startPortal(async () => {
      const res  = await fetch('/api/stripe/portal', { method: 'POST' })
      const data = await res.json()
      if (data.url) window.location.href = data.url
      else alert(data.error ?? 'Could not open billing portal')
    })
  }

  const handleCancel = () => {
    if (!confirm(
      'Are you sure you want to cancel? Your access continues until the end of the billing period.'
    )) return
    startCancel(async () => {
      const result = await getCancelUrl()
      if (result.url) window.location.href = result.url
      else alert(result.error ?? 'Could not open cancellation portal')
    })
  }

  const handleUpgrade = (plan: string) => {
    setUpgradingPlan(plan)
    startUpgrade(async () => {
      const res = await fetch('/api/stripe/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ plan }),
      })
      const data = await res.json()
      if (data.url) window.location.href = data.url
      else { alert(data.error ?? 'Could not start checkout'); setUpgradingPlan(null) }
    })
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-col h-full w-full">
        <PageHeader subtitle="Loading..." />
        <div className="flex-1 flex items-center justify-center">
          <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  const cyclePrice = (monthly: number, yearly: number) =>
    billingCycle === 'yearly' ? yearly : monthly

  const isBeta          = agency?.is_beta ?? false
  const status          = agency?.subscription_status ?? 'trial'
  const statusKey       = isBeta ? 'beta' : status
  const statusCfg       = STATUS_CFG[statusKey] ?? STATUS_CFG.trial
  const StatusIcon      = statusCfg.icon
  const hasSubscription = !!agency?.stripe_subscription_id

  // ═══════════════════════════════════════════════════════════════════════════
  // CASE A: Agency Owner on Agency/Professional/Enterprise tier  →  $749/mo
  // ═══════════════════════════════════════════════════════════════════════════
  if (billingCase === 'owner_agency') {
    const basePrice    = cyclePrice(AGENCY_MONTHLY, AGENCY_YEARLY)
    const overageSeats = Math.max(0, activeSeats - includedSeats)
    const overageCost  = overageSeats * (billingCycle === 'yearly' ? 41.50 : 49)
    const totalCost    = basePrice + overageCost

    return (
      <div className="flex flex-col h-full w-full">
        <PageHeader subtitle="Agency subscription &amp; seats" />
        <div className="flex-1 overflow-y-auto p-8 max-w-3xl mx-auto w-full space-y-6 pb-32">

          {showCancelled && <CancelledBanner endDate={agency?.current_period_end} />}

          {/* ── Billing cycle toggle ── */}
          <div className="flex items-center justify-center gap-3 py-2">
            <span className={cn("text-xs font-black uppercase tracking-widest transition-colors", billingCycle === 'monthly' ? "text-foreground" : "text-muted-foreground")}>Monthly</span>
            <button
              type="button"
              onClick={() => {
                const next = billingCycle === 'monthly' ? 'yearly' : 'monthly'
                setBillingCycle(next)
                localStorage.setItem('billing_cycle', next)
              }}
              className={cn(
                "relative w-12 h-6 rounded-full border transition-all duration-200",
                billingCycle === 'yearly' ? "bg-primary border-primary" : "bg-muted border-border"
              )}
            >
              <span className={cn(
                "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-200",
                billingCycle === 'yearly' ? "left-7" : "left-0.5"
              )} />
            </button>
            <div className="flex items-center gap-2">
              <span className={cn("text-xs font-black uppercase tracking-widest transition-colors", billingCycle === 'yearly' ? "text-foreground" : "text-muted-foreground")}>Yearly</span>
              {billingCycle === 'yearly' && (
                <Badge className="bg-primary/10 text-primary border-primary/20 text-[9px] font-black uppercase tracking-widest px-2 h-5">Save 17%</Badge>
              )}
            </div>
          </div>

          {/* ── Primary plan card ── */}
          <Card className="rounded-3xl border border-border shadow-sm">
            <CardContent className="p-8 space-y-6">
              <div className="flex items-start justify-between">
                <div className="space-y-3">
                  <Badge className={`font-black uppercase text-[9px] px-3 h-6 border flex items-center gap-1.5 w-fit ${statusCfg.cls}`}>
                    <StatusIcon className="w-3 h-3" />
                    {statusCfg.label}
                  </Badge>
                  <p className="text-2xl font-black uppercase tracking-tight">Agency Plan</p>
                  <p className="text-3xl font-black">
                    ${totalCost.toLocaleString()}
                    <span className="text-sm text-muted-foreground font-bold">/mo</span>
                  </p>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Building2 className="w-6 h-6 text-primary" />
                </div>
              </div>

              {isBeta && (
                <div className="rounded-2xl bg-blue-500/5 border border-blue-500/15 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-blue-400 mb-1">Complimentary Beta Access</p>
                  <p className="text-[11px] text-muted-foreground">No charges during beta. You'll be notified before billing begins.</p>
                </div>
              )}

              {!isBeta && agency?.current_period_end && (
                <p className="text-[11px] font-bold text-muted-foreground">
                  {status === 'active' ? 'Renews' : 'Expires'} {fmtDate(agency.current_period_end)}
                </p>
              )}

              {/* Seat cost breakdown */}
              <div className="rounded-2xl bg-muted/40 border border-border px-5 py-4 space-y-2">
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-muted-foreground font-bold">
                    Base plan ({includedSeats} broker seat{includedSeats !== 1 ? 's' : ''} included)
                  </span>
                  <span className="font-black">${basePrice}/mo{billingCycle === 'yearly' ? ' · $7,464/yr' : ''}</span>
                </div>
                {overageSeats > 0 && (
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-muted-foreground font-bold">
                      +{overageSeats} additional broker{overageSeats !== 1 ? 's' : ''} × $49/mo
                    </span>
                    <span className="text-amber-400 font-black">+${overageCost}/mo</span>
                  </div>
                )}
                <div className="border-t border-border pt-2 flex justify-between items-center">
                  <span className="text-[12px] font-black uppercase tracking-widest">Total</span>
                  <span className="text-[12px] font-black">${totalCost.toLocaleString()}/mo</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                {hasSubscription && (
                  <Button onClick={handlePortal} disabled={portalPending} variant="outline"
                    className="flex-1 rounded-xl font-black uppercase text-[10px] tracking-widest h-10 gap-2">
                    {portalPending
                      ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      : <ExternalLink className="w-3.5 h-3.5" />}
                    Manage Billing
                  </Button>
                )}
                {!hasSubscription && !isBeta && (
                  <Button onClick={() => handleUpgrade('agency')} disabled={upgradePending}
                    className="flex-1 rounded-xl font-black uppercase text-[10px] tracking-widest h-10 gap-2">
                    {upgradePending
                      ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      : <ArrowUpRight className="w-3.5 h-3.5" />}
                    Activate Paid Plan
                  </Button>
                )}
              </div>
              {hasSubscription && status !== 'cancelled' && (
                <div className="flex justify-center pt-1">
                  <button onClick={handleCancel} disabled={cancelPending}
                    className="text-red-400/70 hover:text-red-400 text-[11px] font-bold transition-colors disabled:opacity-50">
                    {cancelPending ? 'Opening portal...' : 'Cancel Subscription'}
                  </button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Live seat utilization card ── */}
          <Card className="rounded-3xl border border-border shadow-sm">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Users className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest">Seat Utilization</p>
                  <p className="text-[9px] text-muted-foreground">
                    {activeSeats} of {includedSeats} included seats active
                    {overageSeats > 0 && ` · ${overageSeats} overage`}
                  </p>
                </div>
                <Button asChild variant="outline" size="sm"
                  className="ml-auto rounded-xl font-black uppercase text-[9px] tracking-widest h-8 px-3">
                  <Link href="/dashboard/team">Manage Team</Link>
                </Button>
              </div>

              {/* Seat usage bar */}
              <div className="space-y-1.5">
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${overageSeats > 0 ? 'bg-amber-500' : 'bg-primary'}`}
                    style={{ width: `${Math.min(100, (activeSeats / Math.max(includedSeats, 1)) * 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[9px] text-muted-foreground font-bold uppercase">
                  <span>{activeSeats} active</span>
                  <span>{includedSeats} included · +$49/seat overage</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── Subscription lifecycle controls ── */}
          <div className="border-t border-border/50 pt-2">
            <Card className="rounded-3xl border border-red-500/10 bg-red-500/[0.02] shadow-sm">
              <CardContent className="p-7">
                <BillingLifecyclePanel
                  currentStatus={agency?.subscription_status ?? 'active'}
                  currentPeriodEnd={agency?.current_period_end ?? null}
                  agencyName={agency?.name ?? 'Your Agency'}
                />
              </CardContent>
            </Card>
          </div>

        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CASE B: Agency Owner on Solo/Broker tier  →  $149/mo
  // ═══════════════════════════════════════════════════════════════════════════
  if (billingCase === 'owner_broker') {
    return (
      <div className="flex flex-col h-full w-full">
        <PageHeader subtitle="Your individual broker plan" />
        <div className="flex-1 overflow-y-auto p-8 max-w-2xl mx-auto w-full space-y-6 pb-32">

          {showCancelled && <CancelledBanner endDate={agency?.current_period_end} />}

          {/* ── Billing cycle toggle ── */}
          <div className="flex items-center justify-center gap-3 py-2">
            <span className={cn("text-xs font-black uppercase tracking-widest transition-colors", billingCycle === 'monthly' ? "text-foreground" : "text-muted-foreground")}>Monthly</span>
            <button
              type="button"
              onClick={() => {
                const next = billingCycle === 'monthly' ? 'yearly' : 'monthly'
                setBillingCycle(next)
                localStorage.setItem('billing_cycle', next)
              }}
              className={cn(
                "relative w-12 h-6 rounded-full border transition-all duration-200",
                billingCycle === 'yearly' ? "bg-primary border-primary" : "bg-muted border-border"
              )}
            >
              <span className={cn(
                "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-200",
                billingCycle === 'yearly' ? "left-7" : "left-0.5"
              )} />
            </button>
            <div className="flex items-center gap-2">
              <span className={cn("text-xs font-black uppercase tracking-widest transition-colors", billingCycle === 'yearly' ? "text-foreground" : "text-muted-foreground")}>Yearly</span>
              {billingCycle === 'yearly' && (
                <Badge className="bg-primary/10 text-primary border-primary/20 text-[9px] font-black uppercase tracking-widest px-2 h-5">Save 17%</Badge>
              )}
            </div>
          </div>

          {/* ── Plan card ── */}
          <Card className="rounded-3xl border border-border shadow-sm">
            <CardContent className="p-8 space-y-5">
              <div className="flex items-start justify-between">
                <div className="space-y-3">
                  <Badge className={`font-black uppercase text-[9px] px-3 h-6 border flex items-center gap-1.5 w-fit ${statusCfg.cls}`}>
                    <StatusIcon className="w-3 h-3" />
                    {statusCfg.label}
                  </Badge>
                  <p className="text-2xl font-black uppercase tracking-tight">Individual Broker Plan</p>
                  <p className="text-3xl font-black">
                    ${cyclePrice(BROKER_MONTHLY, BROKER_YEARLY)}<span className="text-sm text-muted-foreground font-bold">/mo</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    1 seat · {billingCycle === 'yearly' ? 'billed $1,488/yr' : 'month-to-month'} · cancel any time
                  </p>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <User className="w-6 h-6 text-primary" />
                </div>
              </div>

              {isBeta && (
                <div className="rounded-2xl bg-blue-500/5 border border-blue-500/15 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-blue-400 mb-1">Complimentary Beta Access</p>
                  <p className="text-[11px] text-muted-foreground">No charge until you upgrade. You'll be notified before billing begins.</p>
                </div>
              )}

              {!isBeta && status === 'trial' && (
                <div className="rounded-2xl bg-amber-500/5 border border-amber-500/15 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-400 mb-1">Free Trial</p>
                  {agency?.current_period_end && (
                    <p className="text-[11px] text-muted-foreground">Expires {fmtDate(agency.current_period_end)}</p>
                  )}
                </div>
              )}

              {!isBeta && status === 'active' && agency?.current_period_end && (
                <div className="rounded-2xl bg-muted/40 border border-border px-4 py-3 flex items-center gap-3">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Subscription Active</p>
                    <p className="text-[11px] text-muted-foreground">
                      Next renewal: <span className="font-black text-foreground">{fmtDate(agency.current_period_end)}</span>
                    </p>
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-1">
                {hasSubscription && (
                  <Button onClick={handlePortal} disabled={portalPending} variant="outline"
                    className="flex-1 rounded-xl font-black uppercase text-[10px] tracking-widest h-10 gap-2">
                    {portalPending
                      ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      : <ExternalLink className="w-3.5 h-3.5" />}
                    Manage Billing
                  </Button>
                )}
                {!hasSubscription && !isBeta && (
                  <Button onClick={() => handleUpgrade('broker')} disabled={upgradePending}
                    className="flex-1 rounded-xl font-black uppercase text-[10px] tracking-widest h-10 gap-2">
                    {upgradePending && upgradingPlan === 'broker'
                      ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      : <ArrowUpRight className="w-3.5 h-3.5" />}
                    Activate $149/mo Plan
                  </Button>
                )}
              </div>

              {hasSubscription && status !== 'cancelled' && (
                <div className="flex justify-center pt-1">
                  <button onClick={handleCancel} disabled={cancelPending}
                    className="text-red-400/70 hover:text-red-400 text-[11px] font-bold transition-colors disabled:opacity-50">
                    {cancelPending ? 'Opening portal...' : 'Cancel Subscription'}
                  </button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Upgrade pitch ── */}
          <Card className="rounded-3xl border border-primary/20 bg-primary/5 shadow-sm">
            <CardContent className="p-7 space-y-4">
              <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Building2 className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-black uppercase tracking-tight mb-2">Scale to an Agency for $749/mo</p>
                <ul className="space-y-1.5">
                  {[
                    '5 broker seats included, $49/mo per additional',
                    'Agency-wide churn monitor & override alerts',
                    'Manager Control Center & downline roster',
                    'Revenue-at-risk dashboard',
                  ].map(f => (
                    <li key={f} className="flex items-center gap-2">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                      <span className="text-[11px] text-muted-foreground">{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <Button onClick={() => handleUpgrade('agency')} disabled={upgradePending}
                className="rounded-xl font-black uppercase text-[10px] tracking-widest h-10 gap-2 w-fit">
                {upgradePending && upgradingPlan === 'agency'
                  ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  : <ArrowUpRight className="w-3.5 h-3.5" />}
                Upgrade to Agency Plan
              </Button>
            </CardContent>
          </Card>

          {/* ── Subscription lifecycle controls ── */}
          <div className="border-t border-border/50 pt-2">
            <Card className="rounded-3xl border border-red-500/10 bg-red-500/[0.02] shadow-sm">
              <CardContent className="p-7">
                <BillingLifecyclePanel
                  currentStatus={agency?.subscription_status ?? 'active'}
                  currentPeriodEnd={agency?.current_period_end ?? null}
                  agencyName={agency?.name ?? 'Your Account'}
                />
              </CardContent>
            </Card>
          </div>

        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CASE C: Sub-broker under an agency  →  read-only view
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="flex flex-col h-full w-full">
      <PageHeader subtitle="Your access" />
      <div className="flex-1 overflow-y-auto p-8 max-w-2xl mx-auto w-full space-y-6 pb-32">

        <Card className="rounded-3xl border border-border shadow-sm">
          <CardContent className="p-8 space-y-5">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Lock className="w-6 h-6 text-primary" />
            </div>
            <div className="space-y-2">
              <p className="text-xl font-black uppercase tracking-tight">Seat Access</p>
              <p className="text-sm font-bold text-muted-foreground">
                Your seat is included in{' '}
                {ownerAgencyName
                  ? <span className="font-black text-foreground">{ownerAgencyName}</span>
                  : 'your agency'
                }
                's plan.
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Contact your agency owner to make billing or seat changes.
              </p>
            </div>
            {agency && (
              <div className="rounded-2xl bg-muted/40 border border-border px-5 py-4 flex items-center justify-between">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1">Agency Plan</p>
                  <p className="text-sm font-black">
                    {AGENCY_TIERS.includes(agency.subscription_tier ?? '') ? 'Agency Plan · $749/mo' : 'Individual Broker · $149/mo'}
                  </p>
                </div>
                <Badge className={`font-black uppercase text-[9px] px-3 h-6 border ${statusCfg.cls}`}>
                  {statusCfg.label}
                </Badge>
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  )
}

/**
 * billing-v2/pricing-sandbox.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * SANDBOX ONLY — not connected to live Stripe webhooks or payment APIs.
 * This component lives in /billing-v2/ and must remain isolated until
 * the new pricing tier migration is approved and the Stripe product IDs
 * are finalized. Do NOT import from active billing routes.
 *
 * New pricing (as of 2026-05):
 *   Broker:  $149/mo  |  $119/mo billed annually
 *   Agency:  $749/mo base + $49/broker seat  |  $599/mo annual + $39/seat
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use client"

import { useState } from "react"
import { CheckCircle2, Zap, Building2, Shield, Lock, Send, Plus, Minus } from "lucide-react"

// ── Sandbox plan config (not yet wired to Stripe) ─────────────────────────────
export const SANDBOX_PLANS = {
  broker: {
    monthly: { price: 149, label: "$149/mo", stripeProductId: "SANDBOX_BROKER_MONTHLY" },
    annual:  { price: 119, label: "$119/mo", stripeProductId: "SANDBOX_BROKER_ANNUAL", savings: 360 },
  },
  agency: {
    monthly: {
      base: 749, perSeat: 49,
      label: "$749/mo base",
      stripeProductId: "SANDBOX_AGENCY_MONTHLY",
    },
    annual: {
      base: 599, perSeat: 39,
      label: "$599/mo base",
      stripeProductId: "SANDBOX_AGENCY_ANNUAL",
      savings: 1800,
    },
  },
} as const

const BROKER_FEATURES = [
  "1 broker seat",
  "Personal book-of-business protection",
  "MBI lookup & Chrome Extension sync",
  "48-hour roster change monitoring",
  "VCC fax automation to physicians",
  "Churn & switch alerts",
  "GoHighLevel CRM integration",
  "AEP Shield campaign tools",
  "AI retention scripts",
]

const AGENCY_FEATURES = [
  "Everything in Broker plan",
  "Manager Control Center dashboard",
  "Downline roster tracking",
  "Agency-wide override leak alerts",
  "Volume license management",
  "Role-based permissions (Owner / Manager / CS)",
  "Revenue-at-risk monitoring",
  "Master roster import",
  "VCC on behalf of any broker",
  "BAA execution included",
  "Priority enterprise support",
]

interface SandboxCheckoutPayload {
  plan: "broker" | "agency"
  billing: "monthly" | "annual"
  brokerSeats?: number
  stripeProductId: string
  estimatedMonthly: number
}

interface Props {
  /** Callback receives the sandbox payload — wire to real Stripe when ready */
  onCheckout?: (payload: SandboxCheckoutPayload) => void
  /** Show a "SANDBOX" watermark for internal testing */
  showSandboxBadge?: boolean
}

export function PricingSandbox({ onCheckout, showSandboxBadge = true }: Props) {
  const [billing, setBilling] = useState<"monthly" | "annual">("monthly")
  const [brokerSeats, setBrokerSeats] = useState(1)

  const brokerPlan = SANDBOX_PLANS.broker[billing]
  const agencyPlan = SANDBOX_PLANS.agency[billing]
  const agencyMonthly = agencyPlan.base + (brokerSeats * agencyPlan.perSeat)

  const handleBrokerCheckout = () => {
    const payload: SandboxCheckoutPayload = {
      plan: "broker",
      billing,
      stripeProductId: brokerPlan.stripeProductId,
      estimatedMonthly: brokerPlan.price,
    }
    console.info("[billing-v2 SANDBOX] Broker checkout payload:", payload)
    onCheckout?.(payload)
  }

  const handleAgencyCheckout = () => {
    const payload: SandboxCheckoutPayload = {
      plan: "agency",
      billing,
      brokerSeats,
      stripeProductId: agencyPlan.stripeProductId,
      estimatedMonthly: agencyMonthly,
    }
    console.info("[billing-v2 SANDBOX] Agency checkout payload:", payload)
    onCheckout?.(payload)
  }

  return (
    <div className="relative">
      {showSandboxBadge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10 bg-amber-400 text-amber-900 text-[9px] font-black uppercase tracking-widest px-4 py-1 rounded-full shadow-lg">
          ⚠ Sandbox — Not Live
        </div>
      )}

      {/* Billing toggle */}
      <div className="flex items-center justify-center gap-3 mb-10">
        <span className={"text-[10px] font-black uppercase tracking-widest transition-colors " + (billing === "monthly" ? "text-slate-900" : "text-slate-400")}>
          Monthly
        </span>
        <button
          onClick={() => setBilling(b => b === "monthly" ? "annual" : "monthly")}
          className={"relative w-12 h-6 rounded-full transition-colors " + (billing === "annual" ? "bg-primary" : "bg-slate-300")}
        >
          <span className={"absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform " + (billing === "annual" ? "translate-x-7" : "translate-x-1")} />
        </button>
        <span className={"text-[10px] font-black uppercase tracking-widest transition-colors " + (billing === "annual" ? "text-slate-900" : "text-slate-400")}>
          Annual <span className="text-primary">— Save 20%</span>
        </span>
      </div>

      <div className="grid md:grid-cols-2 gap-6">

        {/* ── Broker Card ───────────────────────────────────────────────── */}
        <div className="rounded-3xl border border-slate-200 bg-white p-8 flex flex-col shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-2xl bg-slate-900 flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Independent Broker</p>
              <p className="text-lg font-black text-slate-900">Solo Plan</p>
            </div>
          </div>

          <div className="flex items-baseline gap-1 mb-1">
            <span className="text-5xl font-black text-slate-900">${brokerPlan.price}</span>
            <span className="text-sm font-black text-slate-400 uppercase">/mo</span>
          </div>
          {billing === "annual" && (
            <p className="text-[10px] font-black text-primary uppercase tracking-widest mb-4">
              Billed annually · Save ${SANDBOX_PLANS.broker.annual.savings}/yr
            </p>
          )}
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-8">One broker seat · Cancel monthly</p>

          <ul className="space-y-2.5 mb-8 flex-1">
            {BROKER_FEATURES.map(f => (
              <li key={f} className="flex items-start gap-2.5 text-[11px] font-medium text-slate-600">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />{f}
              </li>
            ))}
          </ul>

          <button
            onClick={handleBrokerCheckout}
            className="w-full h-14 rounded-2xl font-black uppercase text-[10px] tracking-widest bg-slate-900 text-white hover:bg-primary transition-all"
          >
            {showSandboxBadge ? "[SANDBOX] " : ""}Start Free Trial
          </button>
        </div>

        {/* ── Agency Card ───────────────────────────────────────────────── */}
        <div className="rounded-3xl border-0 ring-2 ring-primary bg-slate-950 p-8 flex flex-col relative overflow-hidden">
          <div className="absolute top-4 right-4 bg-primary/20 text-primary text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-full border border-primary/30">
            Enterprise
          </div>

          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-2xl bg-primary/20 border border-primary/30 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-primary/60">Agency Owner</p>
              <p className="text-lg font-black text-white">Agency Plan</p>
            </div>
          </div>

          <div className="flex items-baseline gap-1 mb-1">
            <span className="text-5xl font-black text-white">${agencyPlan.base}</span>
            <span className="text-sm font-black text-white/40 uppercase">/mo base</span>
          </div>
          {billing === "annual" && (
            <p className="text-[10px] font-black text-primary uppercase tracking-widest mb-1">
              Billed annually · Save ${SANDBOX_PLANS.agency.annual.savings}/yr
            </p>
          )}
          <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-2">
            +${agencyPlan.perSeat}/broker seat/mo
          </p>

          {/* Broker seat calculator */}
          <div className="rounded-2xl bg-white/5 border border-white/10 p-4 mb-6 space-y-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-white/40">Broker Seats</p>
            <div className="flex items-center gap-4">
              <button onClick={() => setBrokerSeats(s => Math.max(1, s - 1))}
                className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors">
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="text-2xl font-black text-white w-8 text-center">{brokerSeats}</span>
              <button onClick={() => setBrokerSeats(s => s + 1)}
                className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors">
                <Plus className="w-3.5 h-3.5" />
              </button>
              <div className="ml-auto text-right">
                <p className="text-white font-black text-lg">${agencyMonthly}<span className="text-white/30 text-xs font-bold">/mo</span></p>
                <p className="text-[9px] font-black text-white/30 uppercase tracking-widest">estimated total</p>
              </div>
            </div>
            <p className="text-[9px] text-white/20 font-medium">
              Base ${agencyPlan.base} + ({brokerSeats} seat{brokerSeats !== 1 ? "s" : ""} × ${agencyPlan.perSeat}) = ${agencyMonthly}/mo
            </p>
          </div>

          <ul className="space-y-2.5 mb-8 flex-1">
            {AGENCY_FEATURES.map(f => (
              <li key={f} className="flex items-start gap-2.5 text-[11px] font-medium text-white/60">
                <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />{f}
              </li>
            ))}
          </ul>

          {/* Annual commitment notice */}
          <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 mb-4">
            <p className="text-[9px] font-black uppercase tracking-widest text-amber-400">
              Annual contract required · Non-cancellable mid-term · Net-30 invoicing available
            </p>
          </div>

          <button
            onClick={handleAgencyCheckout}
            className="w-full h-14 rounded-2xl font-black uppercase text-[10px] tracking-widest bg-primary hover:bg-primary/90 text-white shadow-xl shadow-primary/30 transition-all flex items-center justify-center gap-2"
          >
            <Send className="w-3.5 h-3.5" />
            {showSandboxBadge ? "[SANDBOX] " : ""}Request Enterprise Onboarding
          </button>
        </div>
      </div>

      {/* Trust strip */}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-6">
        {[{ icon: Shield, label: "HIPAA Compliant" }, { icon: Lock, label: "AES-256 Encrypted" }, { icon: CheckCircle2, label: "BAA Included for Agencies" }].map(({ icon: Icon, label }) => (
          <div key={label} className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">
            <Icon className="w-3 h-3" />{label}
          </div>
        ))}
      </div>
    </div>
  )
}

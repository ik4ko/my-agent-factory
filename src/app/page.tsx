"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import {
  Activity,
  BellRing,
  Check,
  DatabaseZap,
  FileText,
  LockKeyhole,
  Megaphone,
  ShieldCheck,
  UploadCloud,
} from "lucide-react"
import { cn } from "@/lib/utils"

import { Logo } from "@/components/logo"
import { SiteNavbar } from "@/components/site-navbar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

const steps = [
  {
    title: "Connect your book of business",
    description: "Upload your client roster. Name, member ID, and current plan is all we need.",
    icon: UploadCloud,
  },
  {
    title: "We monitor CMS enrollment data",
    description: "Automated checks surface plan changes, disenrollments, and upcoming switches.",
    icon: DatabaseZap,
  },
  {
    title: "You get the alert in time",
    description: "Know which clients need outreach before the change takes effect.",
    icon: BellRing,
  },
]

const pillars = [
  {
    title: "Plan Switch Detection",
    description:
      "Get notified the moment a client's Medicare Advantage plan status changes or a future switch is detected.",
    icon: Activity,
  },
  {
    title: "Clinical Form Routing",
    description:
      "For members on chronic condition plans, we route the necessary forms to their care team automatically.",
    icon: FileText,
  },
  {
    title: "Broker Campaigns",
    description:
      "Send plan updates, wellness check-ins, and renewal reminders to your book — on your schedule.",
    icon: Megaphone,
  },
]

const stats: { value: string | null; detail: string }[] = [
  { value: "27%",   detail: "of MA clients switch plans every year" },
  { value: "60+",   detail: "days before most switches are discovered" },
  { value: "Jan 1", detail: "AEP enrollment window closes" },
  { value: null,    detail: "One alert. One call. Client retained." },
]

const BROKER_FEATURES = [
  "Plan switch detection for your book of business",
  "VCC / SSBCI form routing for your clients",
  "Broker campaign messaging",
  "CMS enrollment monitoring",
  "HIPAA-compliant audit logging",
  "Email alerts on plan changes",
]

const AGENCY_EXTRA = [
  "Up to 5 seats included",
  "Agency-wide rollup dashboard",
  "Owner, Manager, and Customer Service roles",
  "Mass campaign messaging across all brokers",
  "Centralized VCC/SSBCI form management",
  "Full audit trail across all brokers",
  "Additional seats available at +$50/seat/mo",
]

function useInView<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [isInView, setIsInView] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true)
          observer.unobserve(entry.target)
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.18 }
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return { ref, isInView }
}

function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  const { ref, isInView } = useInView<HTMLDivElement>()

  return (
    <div
      ref={ref}
      className={`${className} transition-all duration-700 ease-out ${
        isInView ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
      }`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  )
}

export default function LandingPage() {
  const [yearly, setYearly] = useState(false)

  const brokerPrice = yearly ? 124 : 149
  const agencyPrice = yearly ? 622 : 749
  const seatAddon   = yearly ? "+$41.50" : "+$50"

  return (
    <div className="min-h-screen scroll-smooth bg-[#0a0a0f] text-white selection:bg-primary/20">
      <SiteNavbar />

      <main>
        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden px-4 py-16 sm:px-6 md:py-24">
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(20,184,166,0.08),rgba(10,10,15,0)_42%)]" />
          <div className="relative mx-auto grid max-w-7xl gap-12 lg:grid-cols-[1fr_0.78fr] lg:items-center">
            <Reveal className="space-y-8">
              <Badge className="border-primary/30 bg-primary/10 text-primary">
                Medicare Retention SaaS
              </Badge>
              <div className="space-y-6">
                <h1 className="headline-reveal max-w-5xl text-5xl font-black leading-[0.95] tracking-tight text-white sm:text-6xl lg:text-7xl">
                  Know before the switch. Not after.
                </h1>
                <p className="max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">
                  AegisSage monitors your Medicare Advantage book and alerts you while there's still time to act.
                </p>
              </div>
            </Reveal>

            <Reveal delay={140}>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="rounded-xl border border-white/10 bg-[#0a0a0f] p-4">
                  <div className="mb-5 flex items-center justify-between border-b border-white/10 pb-4">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-500">Live retention desk</p>
                      <p className="mt-1 text-lg font-black text-white">Switch alerts</p>
                    </div>
                    <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-200">Monitoring</Badge>
                  </div>
                  <div className="space-y-3">
                    {[
                      ["Margaret T.", "Pending plan change", "Critical"],
                      ["Robert S.", "Disenrollment signal", "Review"],
                      ["Linda P.", "Verified unchanged", "Clear"],
                    ].map(([name, signal, status]) => (
                      <div key={name} className="grid grid-cols-[1fr_auto] gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-4">
                        <div>
                          <p className="font-bold text-white">{name}</p>
                          <p className="text-sm text-slate-500">{signal}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-black uppercase tracking-widest text-primary">{status}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── Stats bar ────────────────────────────────────────────────────── */}
        <section className="border-y border-white/10 px-4 py-8 sm:px-6">
          <div className="mx-auto grid max-w-7xl grid-cols-2 gap-3 md:grid-cols-4">
            {stats.map((stat, i) => (
              <Reveal key={i} delay={i * 80}>
                <div className="flex h-full flex-col items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] p-5 text-center">
                  {stat.value !== null ? (
                    <>
                      <p className="text-3xl font-black text-primary">{stat.value}</p>
                      <p className="mt-1.5 text-xs leading-5 text-slate-500">{stat.detail}</p>
                    </>
                  ) : (
                    <p className="text-sm font-black leading-snug text-slate-300">{stat.detail}</p>
                  )}
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── How It Works ─────────────────────────────────────────────────── */}
        <section id="how-it-works" className="px-4 py-20 sm:px-6 md:py-28">
          <div className="mx-auto max-w-7xl space-y-10">
            <Reveal className="max-w-3xl space-y-4">
              <Badge className="border-white/10 bg-white/5 text-slate-300">How it works</Badge>
              <h2 className="text-3xl font-black tracking-tight sm:text-5xl">A three-step flow built for retention teams.</h2>
            </Reveal>
            <div className="grid gap-4 md:grid-cols-3 md:items-stretch">
              {steps.map((step, index) => (
                <Reveal key={step.title} delay={index * 110}>
                  <Card className="h-full border-white/10 bg-white/[0.04] p-6">
                    <div className="mb-6 flex items-center justify-between">
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <step.icon className="h-6 w-6" />
                      </div>
                      <span className="font-mono text-sm text-slate-600">0{index + 1}</span>
                    </div>
                    <h3 className="text-xl font-black text-white">{step.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-400">{step.description}</p>
                  </Card>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── What We Do ───────────────────────────────────────────────────── */}
        <section id="what-we-do" className="border-y border-white/10 bg-slate-900/40 px-4 py-20 sm:px-6 md:py-28">
          <div className="mx-auto max-w-7xl space-y-10">
            <Reveal className="max-w-3xl space-y-4">
              <Badge className="border-white/10 bg-white/5 text-slate-300">What we do</Badge>
              <h2 className="text-3xl font-black tracking-tight sm:text-5xl">Three capabilities. One platform.</h2>
            </Reveal>
            <div className="grid gap-4 md:grid-cols-3 md:items-stretch">
              {pillars.map((pillar, index) => (
                <Reveal key={pillar.title} delay={index * 110}>
                  <Card className="h-full border-white/10 bg-slate-950/80 p-6">
                    <pillar.icon className="h-7 w-7 text-primary" />
                    <h3 className="mt-5 text-lg font-black text-white">{pillar.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-400">{pillar.description}</p>
                  </Card>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── Pricing ──────────────────────────────────────────────────────── */}
        <section id="pricing" className="px-4 py-20 sm:px-6 md:py-28">
          <div className="mx-auto max-w-5xl space-y-12">

            <Reveal className="text-center space-y-4">
              <Badge className="border-primary/30 bg-primary/10 text-primary">Simple Pricing</Badge>
              <h2 className="text-4xl font-black uppercase tracking-tighter sm:text-5xl">
                Protect Your Book
              </h2>
              <p className="text-white/50 font-bold text-sm max-w-xl mx-auto">
                Plan switch detection, VCC automation, and retention intelligence — priced for Medicare professionals.
              </p>
            </Reveal>

            {/* Monthly / Yearly toggle */}
            <div className="flex items-center justify-center gap-4">
              <span className={cn("text-sm font-black uppercase tracking-widest transition-colors", !yearly ? "text-white" : "text-white/40")}>
                Monthly
              </span>
              <button
                type="button"
                aria-label="Toggle billing period"
                onClick={() => setYearly(v => !v)}
                className={cn(
                  "relative w-14 h-7 rounded-full border transition-all duration-200",
                  yearly ? "bg-primary border-primary" : "bg-white/10 border-white/20"
                )}
              >
                <span className={cn(
                  "absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all duration-200",
                  yearly ? "left-8" : "left-1"
                )} />
              </button>
              <div className="flex items-center gap-2">
                <span className={cn("text-sm font-black uppercase tracking-widest transition-colors", yearly ? "text-white" : "text-white/40")}>
                  Yearly
                </span>
                <span className={cn(
                  "text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full border transition-all duration-300",
                  yearly
                    ? "bg-primary/20 text-primary border-primary/30 opacity-100 scale-100"
                    : "opacity-0 scale-75 pointer-events-none border-transparent text-transparent"
                )}>
                  Save 17%
                </span>
              </div>
            </div>

            {/* Pricing cards */}
            <div className="grid md:grid-cols-2 gap-6">

              {/* Broker */}
              <Reveal>
                <div className="rounded-3xl border border-white/10 bg-white/5 p-8 flex flex-col h-full">
                  <div className="mb-6">
                    <p className="font-black uppercase tracking-widest text-[11px] text-white/60 mb-1">Broker</p>
                    <div className="flex items-baseline gap-1">
                      <span className="text-5xl font-black tabular-nums">${brokerPrice}</span>
                      <span className="text-white/40 font-black text-xs uppercase tracking-widest">/mo</span>
                    </div>
                    {yearly && <p className="text-[10px] text-primary/70 font-bold mt-1">Billed as $1,488/yr</p>}
                    <p className="text-white/40 text-[11px] font-medium mt-2">For independent brokers managing their own book</p>
                  </div>
                  <ul className="space-y-3 mb-8 flex-1">
                    {BROKER_FEATURES.map(f => (
                      <li key={f} className="flex items-start gap-2.5 text-[12px] font-medium text-white/70">
                        <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Button asChild variant="outline" className="w-full h-14 rounded-2xl font-black uppercase text-[10px] tracking-widest border-white/20 text-white hover:bg-white hover:text-slate-950 transition-all">
                    <Link href="/signup">Get Started</Link>
                  </Button>
                </div>
              </Reveal>

              {/* Agency — recommended */}
              <Reveal delay={120}>
                <div className="rounded-3xl border border-primary bg-primary/5 p-8 flex flex-col h-full relative overflow-hidden">
                  <div className="absolute top-4 right-4">
                    <Badge className="bg-primary text-white font-black uppercase text-[9px] tracking-widest px-3 py-1">
                      Recommended
                    </Badge>
                  </div>
                  <div className="mb-6">
                    <p className="font-black uppercase tracking-widest text-[11px] text-primary/70 mb-1">Agency</p>
                    <div className="flex items-baseline gap-1">
                      <span className="text-5xl font-black tabular-nums">${agencyPrice}</span>
                      <span className="text-white/40 font-black text-xs uppercase tracking-widest">/mo</span>
                    </div>
                    {yearly
                      ? <p className="text-[10px] text-primary/70 font-bold mt-1">Billed as $7,464/yr · includes 5 seats</p>
                      : <p className="text-[10px] text-primary/70 font-bold mt-1">Includes 5 seats</p>
                    }
                    <p className="text-white/40 text-[11px] font-medium mt-2">
                      For agencies with brokers · additional seats {seatAddon}/seat/mo
                    </p>
                  </div>
                  <ul className="space-y-2 mb-8 flex-1">
                    <li className="text-[10px] font-black uppercase tracking-widest text-white/30 mb-1">Everything in Broker, plus:</li>
                    {AGENCY_EXTRA.map(f => (
                      <li key={f} className="flex items-start gap-2.5 text-[12px] font-medium text-white/70">
                        <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Button asChild className="w-full h-14 rounded-2xl font-black uppercase text-[10px] tracking-widest bg-primary hover:bg-primary/90 shadow-xl shadow-primary/20">
                    <Link href="/signup">Get Started</Link>
                  </Button>
                </div>
              </Reveal>
            </div>

            {/* Footer notes */}
            <Reveal className="flex flex-col items-center gap-3 text-center">
              <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest">No refunds. All sales are final.</p>
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-white/30">
                <ShieldCheck className="w-3.5 h-3.5" />
                All plans include HIPAA-compliant infrastructure.
              </div>
            </Reveal>

          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 px-4 py-10 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-8 md:flex-row md:items-center">
          <div className="space-y-3">
            <Logo className="[&_span]:text-white" />
            <p className="max-w-md text-sm text-slate-500">Early detection for Medicare brokers.</p>
          </div>
          <div className="flex flex-col gap-3 text-sm text-slate-500 sm:flex-row sm:items-center sm:gap-5">
            <Link href="/privacy" className="font-bold hover:text-primary">Privacy Policy</Link>
            <Link href="/support" className="font-bold hover:text-primary">Support</Link>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 font-bold text-emerald-200">
              <LockKeyhole className="h-4 w-4" />
              HIPAA-compliant infrastructure
            </div>
            <span className="text-xs">© 2026 AegisSage</span>
          </div>
        </div>
      </footer>
    </div>
  )
}

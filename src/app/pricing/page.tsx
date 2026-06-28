"use client"

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Logo } from '@/components/logo'
import Link from 'next/link'
import { Check, ArrowLeft, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

const BROKER_FEATURES = [
  'Plan switch detection for your book of business',
  'VCC / SSBCI form routing for your clients',
  'Broker campaign messaging',
  'CMS enrollment monitoring',
  'HIPAA-compliant audit logging',
  'Email alerts on plan changes',
]

const AGENCY_EXTRA_FEATURES = [
  'Up to 5 seats included',
  'Agency-wide rollup dashboard',
  'Owner, Manager, and Customer Service roles',
  'Mass campaign messaging across all brokers',
  'Centralized VCC/SSBCI form management',
  'Full audit trail across all brokers',
  'Additional seats available at +$50/seat/mo',
]

export default function PricingPage() {
  const [yearly, setYearly] = useState(false)

  const brokerPrice  = yearly ? 124  : 149
  const agencyPrice  = yearly ? 622  : 749
  const seatAddon    = yearly ? '+$41.50' : '+$50'

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="h-20 px-8 flex items-center justify-between border-b border-white/10">
        <Link href="/"><Logo /></Link>
        <Button variant="ghost" size="sm" asChild className="rounded-xl font-black uppercase text-[10px] tracking-widest text-white/60 hover:text-white hover:bg-white/10">
          <Link href="/"><ArrowLeft className="w-4 h-4 mr-2" /> Home</Link>
        </Button>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-20">
        {/* Headline */}
        <div className="text-center space-y-4 mb-12">
          <Badge className="bg-primary/10 text-primary border-primary/20 font-black uppercase text-[10px] tracking-widest px-4 py-1.5">
            Simple Pricing
          </Badge>
          <h1 className="text-5xl md:text-7xl font-black uppercase tracking-tighter">
            Protect Your Book
          </h1>
          <p className="text-white/50 font-bold text-sm max-w-xl mx-auto">
            Plan switch detection, VCC automation, and retention intelligence —
            priced for Medicare professionals.
          </p>
        </div>

        {/* Monthly / Yearly toggle */}
        <div className="flex items-center justify-center gap-4 mb-14">
          <span className={cn(
            'text-sm font-black uppercase tracking-widest transition-colors',
            !yearly ? 'text-white' : 'text-white/40',
          )}>
            Monthly
          </span>

          <button
            type="button"
            aria-label="Toggle billing period"
            onClick={() => setYearly(v => !v)}
            className={cn(
              'relative w-14 h-7 rounded-full border transition-all duration-200',
              yearly ? 'bg-primary border-primary' : 'bg-white/10 border-white/20',
            )}
          >
            <span className={cn(
              'absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all duration-200',
              yearly ? 'left-8' : 'left-1',
            )} />
          </button>

          <div className="flex items-center gap-2">
            <span className={cn(
              'text-sm font-black uppercase tracking-widest transition-colors',
              yearly ? 'text-white' : 'text-white/40',
            )}>
              Yearly
            </span>
            <span className={cn(
              'text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full border transition-all duration-300',
              yearly
                ? 'bg-primary/20 text-primary border-primary/30 opacity-100 scale-100'
                : 'opacity-0 scale-75 pointer-events-none border-transparent text-transparent',
            )}>
              Save 17%
            </span>
          </div>
        </div>

        {/* Pricing cards */}
        <div className="grid md:grid-cols-2 gap-6">

          {/* Broker */}
          <div className="rounded-3xl border border-white/10 bg-white/5 p-8 flex flex-col">
            <div className="mb-6">
              <p className="font-black uppercase tracking-widest text-[11px] text-white/60 mb-1">Broker</p>
              <div className="flex items-baseline gap-1">
                <span className="text-5xl font-black tabular-nums transition-all duration-200">
                  ${brokerPrice}
                </span>
                <span className="text-white/40 font-black text-xs uppercase tracking-widest">/mo</span>
              </div>
              {yearly && (
                <p className="text-[10px] text-primary/70 font-bold mt-1">Billed as $1,488/yr</p>
              )}
              <p className="text-white/40 text-[11px] font-medium mt-2">
                For independent brokers managing their own book of business
              </p>
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

          {/* Agency — recommended */}
          <div className="rounded-3xl border border-primary bg-primary/5 p-8 flex flex-col relative overflow-hidden">
            <div className="absolute top-4 right-4">
              <Badge className="bg-primary text-white font-black uppercase text-[9px] tracking-widest px-3 py-1">
                Recommended
              </Badge>
            </div>

            <div className="mb-6">
              <p className="font-black uppercase tracking-widest text-[11px] text-primary/70 mb-1">Agency</p>
              <div className="flex items-baseline gap-1">
                <span className="text-5xl font-black tabular-nums transition-all duration-200">
                  ${agencyPrice}
                </span>
                <span className="text-white/40 font-black text-xs uppercase tracking-widest">/mo</span>
              </div>
              {yearly ? (
                <p className="text-[10px] text-primary/70 font-bold mt-1">Billed as $7,464/yr · includes 5 seats</p>
              ) : (
                <p className="text-[10px] text-primary/70 font-bold mt-1">Includes 5 seats</p>
              )}
              <p className="text-white/40 text-[11px] font-medium mt-2">
                For agencies with brokers · additional seats {seatAddon}/seat/mo
              </p>
            </div>

            {/* Features: broker features (inherited) + agency-specific */}
            <ul className="space-y-3 mb-8 flex-1">
              <li className="text-[10px] font-black uppercase tracking-widest text-white/30 mb-1">
                Everything in Broker, plus:
              </li>
              {AGENCY_EXTRA_FEATURES.map(f => (
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
        </div>

        {/* Footer notes */}
        <div className="mt-12 flex flex-col items-center gap-3 text-center">
          <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest">
            No refunds. All sales are final.
          </p>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-white/30">
            <ShieldCheck className="w-3.5 h-3.5" />
            All plans include HIPAA-compliant infrastructure.
          </div>
        </div>
      </main>
    </div>
  )
}

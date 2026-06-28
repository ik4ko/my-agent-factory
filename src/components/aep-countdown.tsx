"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Shield, ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"

function getAEPState(): {
  daysUntil: number
  isActive: boolean
  aepStart: Date
  aepEnd: Date
  nextLabel: string
} {
  const now = new Date()
  const year = now.getFullYear()

  // Try current year's AEP first
  let aepStart = new Date(year, 9, 15) // Oct 15
  let aepEnd   = new Date(year, 11, 7) // Dec 7

  // If we're past Dec 7 of current year, move to next year
  if (now > aepEnd) {
    aepStart = new Date(year + 1, 9, 15)
    aepEnd   = new Date(year + 1, 11, 7)
  }

  const isActive = now >= aepStart && now <= aepEnd
  const daysUntil = isActive
    ? 0
    : Math.ceil((aepStart.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))

  const nextLabel = `Oct 15 – Dec 7, ${aepStart.getFullYear()}`

  return { daysUntil, isActive, aepStart, aepEnd, nextLabel }
}

export function AEPCountdown() {
  const { daysUntil, isActive, nextLabel } = getAEPState()

  const urgency =
    isActive                    ? 'active'
    : daysUntil < 30            ? 'urgent'
    : daysUntil <= 60           ? 'soon'
    :                             'distant'

  const borderCls =
    urgency === 'active' ? 'border-emerald-500/50 bg-emerald-500/5'
    : urgency === 'urgent' ? 'border-red-500/50 bg-red-500/5'
    : urgency === 'soon'   ? 'border-orange-500/40 bg-orange-500/5'
    :                        'border-amber-400/40 bg-amber-400/5'

  const accentCls =
    urgency === 'active' ? 'text-emerald-400'
    : urgency === 'urgent' ? 'text-red-400'
    : urgency === 'soon'   ? 'text-orange-400'
    :                        'text-amber-400'

  const progressPct = isActive ? 100 : Math.max(5, Math.round((1 - daysUntil / 180) * 100))

  const progressColor =
    urgency === 'active' ? 'bg-emerald-500'
    : urgency === 'urgent' ? 'bg-red-500'
    : urgency === 'soon'   ? 'bg-orange-500'
    :                        'bg-amber-400'

  return (
    <div className={cn("rounded-3xl border p-6 flex flex-col sm:flex-row items-start sm:items-center gap-5", borderCls)}>
      <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center shrink-0", urgency === 'active' ? 'bg-emerald-500/20' : 'bg-amber-400/15')}>
        <Shield className={cn("w-6 h-6", accentCls)} />
      </div>

      <div className="flex-1 min-w-0 space-y-2.5">
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">AEP Shield</p>
          {urgency === 'urgent' && (
            <span className={cn("text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border", 'border-red-500/40 text-red-400 bg-red-500/10')}>
              URGENT
            </span>
          )}
          {urgency === 'active' && (
            <span className="text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border border-emerald-500/40 text-emerald-400 bg-emerald-500/10 animate-pulse">
              AEP IS ACTIVE
            </span>
          )}
        </div>

        <p className="text-base font-black uppercase tracking-tight text-foreground">
          {isActive
            ? 'Annual Enrollment Period is open now'
            : `Annual Enrollment Period begins in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`}
        </p>

        <div className="flex items-center gap-3">
          <p className={cn("text-[10px] font-bold shrink-0", accentCls)}>{nextLabel}</p>
          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
            <div className={cn("h-full rounded-full transition-all", progressColor)} style={{ width: `${progressPct}%` }} />
          </div>
          {!isActive && (
            <p className="text-[10px] font-bold text-muted-foreground shrink-0">{daysUntil} days</p>
          )}
        </div>

        <p className="text-[10px] text-muted-foreground font-medium">
          {isActive
            ? 'Enroll clients now and lock them with an AOR before the window closes Dec 7.'
            : 'Start enrolling clients in AEP Shield now to protect your book.'}
        </p>
      </div>

      <Button size="sm" asChild
        className={cn("rounded-xl font-black uppercase text-[10px] tracking-widest gap-1.5 shrink-0",
          urgency === 'active' ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
          : urgency === 'urgent' ? 'bg-red-600 hover:bg-red-700 text-white'
          : '')}>
        <Link href="/dashboard/campaigns">
          Enroll Clients <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </Button>
    </div>
  )
}

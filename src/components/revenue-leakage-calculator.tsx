'use client'

/**
 * RevenueLeakageCalculator
 *
 * Agency Owner dashboard panel that calculates the exact annualized commission
 * revenue at risk from CRITICAL_PENDING member switches.
 *
 * Data model:
 *   Medicare Advantage brokers earn $600–$900/member/year in renewal commissions.
 *   A CRITICAL_PENDING alert means a member is actively switching carriers —
 *   if unresolved, that commission is lost when the switch takes effect.
 *
 *   Revenue at risk = (switchingCount × perMemberValue) + (termedCount × perMemberValue × 0.5)
 *   The 0.5 multiplier for termed members reflects that recovery is still possible
 *   via re-enrollment during SEP/OEP — it's not a guaranteed total loss.
 *
 * Props:
 *   switchingCount — Members with future effective date switches (CRITICAL_PENDING)
 *   termedCount    — Members already termed / fully disenrolled
 *   totalCount     — Total monitored members (used for loss rate %)
 *   perMemberValue — Annual commission per member (default: $600)
 *
 * Visual:
 *   Uses --surface-1/2 CSS tokens (not hardcoded slate values)
 *   Amber accent for CRITICAL_PENDING per brand spec
 *   Red accent for already-termed (unrecoverable)
 */

import { cn } from '@/lib/utils'
import Link from 'next/link'
import {
  TrendingDown, AlertTriangle, ShieldCheck,
  DollarSign, ChevronRight, ArrowUpRight,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

interface RevenueLeakageProps {
  /** Future-effective carrier switches (CRITICAL_PENDING) */
  switchingCount: number
  /** Already-termed / fully disenrolled members */
  termedCount: number
  /** Total monitored members in agency book */
  totalCount: number
  /**
   * Annual commission value per member.
   * Default: $600 (CMS MA renewal commission standard).
   * Override for agencies with higher average plan premiums.
   */
  perMemberValue?: number
  className?: string
}

// ── Calculation Engine ────────────────────────────────────────────────────────

interface LeakageBreakdown {
  /** Full recoverable loss (switching members — still have a chance to retain) */
  switchingLoss: number
  /** Partial recovery loss (termed — recovery possible via SEP/OEP re-enrollment) */
  termedLoss: number
  /** Total annual revenue at risk */
  totalAnnualLoss: number
  /** Monthly cash flow impact */
  monthlyImpact: number
  /** Percentage of book at risk */
  atRiskPercent: number
  /** Whether total loss is "significant" (> $1,000) */
  isMaterial: boolean
}

function calculateLeakage(
  switchingCount: number,
  termedCount: number,
  totalCount: number,
  perMemberValue: number
): LeakageBreakdown {
  const switchingLoss = switchingCount * perMemberValue
  // Termed members: 50% recovery probability via re-enrollment outreach
  const termedLoss    = Math.round(termedCount * perMemberValue * 0.5)
  const totalAnnualLoss = switchingLoss + termedLoss
  const monthlyImpact   = Math.round(totalAnnualLoss / 12)
  const atRiskCount     = switchingCount + termedCount
  const atRiskPercent   = totalCount > 0
    ? Math.round((atRiskCount / totalCount) * 100)
    : 0

  return {
    switchingLoss,
    termedLoss,
    totalAnnualLoss,
    monthlyImpact,
    atRiskPercent,
    isMaterial: totalAnnualLoss >= 1000,
  }
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function fmtUSD(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000)    return `$${fmt(Math.round(n / 1000))}K`
  return `$${fmt(n)}`
}

// ── Sub-components ────────────────────────────────────────────────────────────

function LossLine({
  label, count, amount, accent, icon: Icon,
}: {
  label: string
  count: number
  amount: number
  accent: string
  icon: React.ElementType
}) {
  if (count === 0) return null
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/[0.05] last:border-0">
      <div className="flex items-center gap-2">
        <Icon className={cn('w-3.5 h-3.5 shrink-0', accent)} aria-hidden />
        <span className="text-[11px] font-black uppercase tracking-widest text-slate-400">
          {label}
        </span>
        <span className={cn(
          'text-[9px] font-black px-1.5 py-0.5 rounded-full border',
          accent === 'text-amber-400'
            ? 'bg-amber-400/10 text-amber-300 border-amber-500/20'
            : 'bg-red-500/10 text-red-400 border-red-500/20'
        )}>
          {count} member{count !== 1 ? 's' : ''}
        </span>
      </div>
      <span className={cn('text-[13px] font-black tabular-nums data-cell', accent)}>
        ${fmt(amount)}/yr
      </span>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function RevenueLeakageCalculator({
  switchingCount,
  termedCount,
  totalCount,
  perMemberValue = 600,
  className,
}: RevenueLeakageProps) {
  const calc = calculateLeakage(switchingCount, termedCount, totalCount, perMemberValue)
  const hasLoss = calc.totalAnnualLoss > 0

  // ── Zero-loss state: clean bill of health ──────────────────────────────
  if (!hasLoss) {
    return (
      <div className={cn(
        'rounded-3xl border border-emerald-500/20 bg-emerald-500/[0.04] p-5',
        'shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
        className
      )}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600/80">
              Revenue Leakage Assessment
            </p>
            <p className="text-sm font-black text-emerald-400 mt-0.5">
              No Detected Revenue Risk
            </p>
            <p className="text-[10px] text-slate-500 font-medium">
              {totalCount > 0
                ? `All ${fmt(totalCount)} monitored members are verified active`
                : 'Upload your roster to begin monitoring'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={cn(
      // Surface — uses CSS token, not hardcoded slate
      'rounded-3xl border p-5 space-y-4',
      'bg-[hsl(var(--surface-1))]',
      calc.isMaterial
        ? 'border-amber-500/25 shadow-[inset_0_1px_0_rgba(251,191,36,0.06),0_0_0_1px_rgba(251,191,36,0.06)]'
        : 'border-white/[0.07] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
      className
    )}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className={cn(
            'w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
            calc.isMaterial ? 'bg-amber-400/10' : 'bg-red-500/10'
          )}>
            <DollarSign className={cn(
              'w-4.5 h-4.5',
              calc.isMaterial ? 'text-amber-400' : 'text-red-400'
            )} />
          </div>
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">
              Revenue Leakage Assessment
            </p>
            <p className={cn(
              'text-[11px] font-black uppercase tracking-widest',
              calc.isMaterial ? 'text-amber-300/80' : 'text-slate-400'
            )}>
              {calc.atRiskPercent}% of book at risk
            </p>
          </div>
        </div>

        {/* Live badge */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-[8px] font-black uppercase tracking-widest text-amber-600/80">Live</span>
        </div>
      </div>

      {/* ── Primary Leakage Figure ──────────────────────────────────────────── */}
      <div className={cn(
        'rounded-2xl p-4 border',
        'bg-[hsl(var(--surface-2))]',
        calc.isMaterial
          ? 'border-amber-500/15'
          : 'border-white/[0.05]'
      )}>
        <p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500 mb-1">
          Detected Agency Revenue Leakage
        </p>
        <div className="flex items-baseline gap-2">
          <span className={cn(
            'font-black tracking-tighter leading-none tabular-nums data-cell',
            calc.totalAnnualLoss >= 10_000 ? 'text-4xl' : 'text-5xl',
            calc.isMaterial ? 'text-amber-300' : 'text-red-400'
          )}>
            {fmtUSD(calc.totalAnnualLoss)}
          </span>
          <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">
            / Year
          </span>
        </div>
        <p className="text-[10px] text-slate-500 font-medium mt-1.5">
          ≈ {fmtUSD(calc.monthlyImpact)}/mo · Based on ${fmt(perMemberValue)} avg annual commission/member
        </p>
      </div>

      {/* ── Breakdown ──────────────────────────────────────────────────────── */}
      <div className="space-y-0">
        <LossLine
          label="Critical Pending Switches"
          count={switchingCount}
          amount={calc.switchingLoss}
          accent="text-amber-400"
          icon={AlertTriangle}
        />
        <LossLine
          label="Already Termed / Left"
          count={termedCount}
          amount={calc.termedLoss}
          accent="text-red-400"
          icon={TrendingDown}
        />
      </div>

      {/* ── Methodology Note ───────────────────────────────────────────────── */}
      <p className="text-[8px] text-slate-600 font-medium leading-relaxed">
        Critical Pending = 100% loss risk · Termed = 50% loss risk (recovery possible via SEP/OEP outreach).
        Commission estimate uses ${fmt(perMemberValue)}/member/year CMS MA renewal rate.
      </p>

      {/* ── CTA ────────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 pt-1">
        <Link
          href="/dashboard/alerts"
          className={cn(
            'flex items-center gap-1.5 h-8 px-4 rounded-xl text-[9px] font-black uppercase tracking-widest',
            'transition-all duration-150 border',
            calc.isMaterial
              ? 'bg-amber-400/10 text-amber-300 border-amber-500/30 hover:bg-amber-400/20 hover:border-amber-400/50'
              : 'bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20 hover:border-red-400/50'
          )}
        >
          Review & Recover
          <ChevronRight className="w-3 h-3" aria-hidden />
        </Link>

        {switchingCount > 0 && (
          <Link
            href="/dashboard/vcc"
            className="flex items-center gap-1.5 h-8 px-4 rounded-xl text-[9px] font-black uppercase tracking-widest text-slate-400 border border-slate-700 hover:text-white hover:border-slate-500 hover:bg-slate-800 transition-all duration-150"
          >
            File VCC Forms
            <ArrowUpRight className="w-3 h-3" aria-hidden />
          </Link>
        )}
      </div>
    </div>
  )
}

'use client'

/**
 * AegisMessage — System notification component for AegisSage
 *
 * Handles three tiers of platform communications:
 *   INFO               → Routine system announcements, feature updates, onboarding tips
 *   COMPLIANCE_WARNING → HIPAA reminders, carrier deadline notices, regulatory updates
 *   CRITICAL_RETENTION → Active member loss risk, CRITICAL_PENDING plan switches, retention alerts
 *
 * Usage:
 *   <AegisMessage
 *     type="CRITICAL_RETENTION"
 *     title="3 Members at Carrier Switch Risk"
 *     body="Humana detected plan changes effective January 1. Immediate outreach recommended."
 *     timestamp="2026-01-15 · 09:42 AM"
 *     actionLabel="Review Alerts"
 *     onAction={() => router.push('/dashboard/alerts')}
 *   />
 */

import { cn } from '@/lib/utils'
import { ShieldAlert, ShieldCheck, Info, ChevronRight, Clock } from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

export type AegisMessageType = 'INFO' | 'COMPLIANCE_WARNING' | 'CRITICAL_RETENTION'

export interface AegisMessageProps {
  /** Alert tier — controls colors, icon, and visual weight */
  type: AegisMessageType
  /** Short, scannable headline — 5–10 words ideal */
  title: string
  /** Full message body — 1–3 sentences max */
  body: string
  /** ISO datetime string or pre-formatted label. Displayed below the title. */
  timestamp?: string
  /** CTA button label — appears in bottom-right corner when provided */
  actionLabel?: string
  /** Callback when CTA is clicked */
  onAction?: () => void
  /** Whether to show the animated pulse ring on CRITICAL_RETENTION type */
  pulse?: boolean
  /** Optional sub-label below the action button (e.g., "Deadline: Jan 31") */
  deadline?: string
  /** Appended to the outer container for layout overrides */
  className?: string
}

// ── Config map ───────────────────────────────────────────────────────────────

const CONFIG = {
  INFO: {
    icon: Info,
    borderColor:   'border-l-[hsl(var(--primary))]',
    bgGlow:        'bg-primary/[0.04]',
    headerText:    'text-blue-300',
    badgeBg:       'bg-primary/15 text-primary',
    badgeLabel:    'System Info',
    actionVariant: 'text-primary hover:text-primary/80 border-primary/30 hover:border-primary/60 hover:bg-primary/10',
    iconColor:     'text-primary',
    timestampColor:'text-slate-500',
  },
  COMPLIANCE_WARNING: {
    icon: ShieldCheck,
    borderColor:   'border-l-amber-400',
    bgGlow:        'bg-amber-400/[0.05]',
    headerText:    'text-amber-200',
    badgeBg:       'bg-amber-400/15 text-amber-300',
    badgeLabel:    'Compliance',
    actionVariant: 'text-amber-300 hover:text-amber-200 border-amber-500/30 hover:border-amber-400/60 hover:bg-amber-400/10',
    iconColor:     'text-amber-400',
    timestampColor:'text-amber-600/80',
  },
  CRITICAL_RETENTION: {
    icon: ShieldAlert,
    borderColor:   'border-l-red-500',
    bgGlow:        'bg-red-500/[0.06]',
    headerText:    'text-red-200',
    badgeBg:       'bg-red-500/15 text-red-400',
    badgeLabel:    'Critical',
    actionVariant: 'text-red-400 hover:text-red-300 border-red-500/40 hover:border-red-400/70 hover:bg-red-500/10',
    iconColor:     'text-red-400',
    timestampColor:'text-red-700/80',
  },
} as const

// ── Shield micro-icon (inline SVG — no import dependency) ────────────────────

function ShieldBadge({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <div className="relative flex items-center justify-center shrink-0">
      {pulse && (
        <span className="absolute inset-0 rounded-full animate-ping opacity-30 bg-red-500" />
      )}
      <div className={cn('relative w-8 h-8 flex items-center justify-center rounded-xl', color)}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-4.5 h-4.5"
          aria-hidden="true"
        >
          <path
            d="M12 2L3 6.5V12C3 16.418 7.03 20.582 12 22C16.97 20.582 21 16.418 21 12V6.5L12 2Z"
            className="fill-current opacity-20"
          />
          <path
            d="M12 2L3 6.5V12C3 16.418 7.03 20.582 12 22C16.97 20.582 21 16.418 21 12V6.5L12 2Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </div>
    </div>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export function AegisMessage({
  type,
  title,
  body,
  timestamp,
  actionLabel,
  onAction,
  pulse = type === 'CRITICAL_RETENTION',
  deadline,
  className,
}: AegisMessageProps) {
  const cfg = CONFIG[type]
  const Icon = cfg.icon

  return (
    <div
      role="alert"
      aria-live={type === 'CRITICAL_RETENTION' ? 'assertive' : 'polite'}
      className={cn(
        // Layout
        'relative flex gap-3.5 rounded-2xl p-4',
        // Border-left treatment — the signature visual anchor
        'border border-white/[0.07] border-l-4',
        cfg.borderColor,
        cfg.bgGlow,
        // Subtle inset shadow for depth
        'shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
        className
      )}
    >
      {/* ── Left column: shield badge ── */}
      <ShieldBadge
        color={cfg.badgeBg}
        pulse={pulse && type === 'CRITICAL_RETENTION'}
      />

      {/* ── Right column: content ── */}
      <div className="flex-1 min-w-0 space-y-1.5">

        {/* Header row: badge label + icon */}
        <div className="flex items-center gap-2">
          <span className={cn(
            'inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-[0.12em] px-2 py-0.5 rounded-full',
            cfg.badgeBg
          )}>
            <Icon className="w-2.5 h-2.5" aria-hidden />
            {cfg.badgeLabel}
          </span>

          {/* Timestamp — right-aligned, small */}
          {timestamp && (
            <span className={cn(
              'ml-auto flex items-center gap-1 text-[9px] font-medium tabular-nums shrink-0',
              cfg.timestampColor
            )}>
              <Clock className="w-2.5 h-2.5" aria-hidden />
              {timestamp}
            </span>
          )}
        </div>

        {/* Title */}
        <p className={cn(
          'text-[13px] font-black leading-tight tracking-tight',
          cfg.headerText
        )}>
          {title}
        </p>

        {/* Body */}
        <p className="text-[11px] text-slate-400 leading-relaxed font-medium">
          {body}
        </p>

        {/* Action row */}
        {(actionLabel || deadline) && (
          <div className="flex items-center justify-between pt-1">
            {deadline ? (
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">
                Deadline: {deadline}
              </span>
            ) : <span />}

            {actionLabel && onAction && (
              <button
                onClick={onAction}
                className={cn(
                  'flex items-center gap-1 text-[9px] font-black uppercase tracking-[0.1em]',
                  'px-3 h-6 rounded-lg border transition-all duration-150',
                  cfg.actionVariant
                )}
              >
                {actionLabel}
                <ChevronRight className="w-2.5 h-2.5" aria-hidden />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Convenience wrappers ─────────────────────────────────────────────────────

export function InfoMessage(props: Omit<AegisMessageProps, 'type'>) {
  return <AegisMessage {...props} type="INFO" />
}

export function ComplianceWarning(props: Omit<AegisMessageProps, 'type'>) {
  return <AegisMessage {...props} type="COMPLIANCE_WARNING" />
}

export function CriticalRetentionAlert(props: Omit<AegisMessageProps, 'type'>) {
  return <AegisMessage {...props} type="CRITICAL_RETENTION" />
}

// ── Stack wrapper for multiple messages ──────────────────────────────────────

export function AegisMessageStack({
  messages,
  className,
}: {
  messages: AegisMessageProps[]
  className?: string
}) {
  if (messages.length === 0) return null
  return (
    <div className={cn('space-y-2.5', className)}>
      {messages.map((msg, i) => (
        <AegisMessage key={i} {...msg} />
      ))}
    </div>
  )
}

'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Lead-inbox primitives.
 *
 * Adapted from React Bits patterns (github.com/DavidHDev/react-bits) as
 * copy-paste TypeScript + Tailwind rather than a dependency — the brief calls
 * for a handful of small operational widgets, and pulling a package in for
 * that is not a trade worth making.
 *
 * Patterns used: CountUp, AnimatedList stagger, ShinyText shimmer for skeleton
 * loading, and a fade/slide status transition.
 *
 * ── Motion policy ─────────────────────────────────────────────────────────
 * Every animation here degrades to nothing under `prefers-reduced-motion`,
 * and none of them is the only way information is conveyed — a status is
 * always readable as text, a count is always the real number. This is
 * internal operational UI, so the failure mode of over-animating is an
 * operator who misreads a queue at 7am.
 */

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

// ── Status badge ───────────────────────────────────────────────────────────

export type LeadStatus =
  | 'new'
  | 'notification_failed'
  | 'unassigned'
  | 'assigned'
  | 'contact_attempted'
  | 'waiting_for_response'
  | 'appointment_scheduled'
  | 'enrolled'
  | 'closed'
  | 'do_not_contact'
  | 'needs_manual_review';

/**
 * Plain-English labels. The database values are snake_case enums; nobody
 * scanning a queue at speed should have to translate `waiting_for_response`
 * in their head.
 */
export const STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'New',
  notification_failed: 'Alert failed',
  unassigned: 'Needs owner',
  assigned: 'Assigned',
  contact_attempted: 'Tried to reach',
  waiting_for_response: 'Waiting on them',
  appointment_scheduled: 'Appointment set',
  enrolled: 'Enrolled',
  closed: 'Closed',
  do_not_contact: 'Do not contact',
  needs_manual_review: 'Needs review',
};

const STATUS_TONE: Record<LeadStatus, string> = {
  new: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
  notification_failed: 'bg-red-500/15 text-red-300 ring-red-500/30',
  unassigned: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  assigned: 'bg-indigo-500/15 text-indigo-300 ring-indigo-500/30',
  contact_attempted: 'bg-violet-500/15 text-violet-300 ring-violet-500/30',
  waiting_for_response: 'bg-cyan-500/15 text-cyan-300 ring-cyan-500/30',
  appointment_scheduled: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  enrolled: 'bg-green-500/20 text-green-300 ring-green-500/40',
  closed: 'bg-zinc-500/15 text-zinc-400 ring-zinc-500/30',
  do_not_contact: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  needs_manual_review: 'bg-orange-500/15 text-orange-300 ring-orange-500/30',
};

export function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${STATUS_TONE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

// ── CountUp ────────────────────────────────────────────────────────────────

/** React Bits CountUp, reduced-motion aware. Renders the real value instantly when reduced. */
export function CountUp({ value, durationMs = 600 }: { value: number; durationMs?: number }) {
  const reduced = usePrefersReducedMotion();
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (reduced) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - start) / durationMs, 1);
      setDisplay(Math.round(value * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs, reduced]);

  return <span aria-label={String(value)}>{reduced ? value : display}</span>;
}

// ── AnimatedList ───────────────────────────────────────────────────────────

/**
 * Staggered entrance for a list of cards. The stagger is capped so a long
 * queue does not leave the last item waiting — an operator scanning 40 leads
 * should not watch them trickle in.
 */
export function AnimatedList({
  children,
  className,
}: {
  children: React.ReactNode[];
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();

  return (
    <ul className={className}>
      {children.map((child, index) => (
        <li
          key={index}
          style={
            reduced
              ? undefined
              : {
                  animation: 'lead-fade-up 260ms cubic-bezier(0.16,1,0.3,1) both',
                  animationDelay: `${Math.min(index * 40, 320)}ms`,
                }
          }
        >
          {child}
        </li>
      ))}
      <style>{`
        @keyframes lead-fade-up {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          li { animation: none !important; }
        }
      `}</style>
    </ul>
  );
}

// ── ShinyText skeleton ─────────────────────────────────────────────────────

/** React Bits ShinyText shimmer, used as a loading skeleton. Static when reduced. */
export function SkeletonRow() {
  const reduced = usePrefersReducedMotion();

  return (
    <div
      className="h-24 w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60"
      role="status"
      aria-label="Loading leads"
    >
      <div
        className={`h-full w-full ${reduced ? '' : 'animate-[lead-shimmer_1.4s_ease-in-out_infinite]'}`}
        style={
          reduced
            ? undefined
            : {
                background:
                  'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.05) 50%, transparent 100%)',
                backgroundSize: '200% 100%',
              }
        }
      />
      <style>{`
        @keyframes lead-shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────

export function EmptyState({
  title,
  body,
  icon = '✓',
}: {
  title: string;
  body: string;
  icon?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/40 p-10 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-zinc-800 text-xl text-zinc-400">
        {icon}
      </div>
      <h3 className="mt-4 text-base font-semibold text-zinc-200">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-zinc-400">{body}</p>
    </div>
  );
}

// ── Status transition ──────────────────────────────────────────────────────

/**
 * Crossfades when the status changes, so a transition is noticed in a list
 * that is not being watched closely. Falls back to an instant swap under
 * reduced motion — the status text itself always carries the meaning.
 */
export function StatusTransition({ status }: { status: LeadStatus }) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(status);
  const [fading, setFading] = useState(false);
  const previous = useRef(status);

  useEffect(() => {
    if (status === previous.current) return;
    previous.current = status;

    if (reduced) {
      setShown(status);
      return;
    }

    setFading(true);
    const timer = setTimeout(() => {
      setShown(status);
      setFading(false);
    }, 140);
    return () => clearTimeout(timer);
  }, [status, reduced]);

  return (
    <span
      className="inline-block transition-opacity duration-150 motion-reduce:transition-none"
      style={{ opacity: fading ? 0 : 1 }}
    >
      <StatusBadge status={shown} />
    </span>
  );
}

// ── Activity timeline ──────────────────────────────────────────────────────

export type TimelineEvent = {
  id: string;
  event: string;
  created_at: string;
  detail?: Record<string, unknown>;
};

export function ActivityTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-zinc-500">No activity recorded yet.</p>;
  }

  return (
    <ol className="relative space-y-4 border-l border-zinc-800 pl-5">
      {events.map((event) => (
        <li key={event.id} className="relative">
          <span
            aria-hidden="true"
            className="absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full bg-sky-500 ring-4 ring-zinc-950"
          />
          <p className="text-sm font-medium text-zinc-200">{humanizeEvent(event.event)}</p>
          <time className="text-xs text-zinc-500" dateTime={event.created_at}>
            {new Date(event.created_at).toLocaleString()}
          </time>
        </li>
      ))}
    </ol>
  );
}

function humanizeEvent(event: string): string {
  const map: Record<string, string> = {
    ingested: 'Lead received from the website',
    duplicate_ingest_ignored: 'Duplicate delivery ignored',
    assigned: 'Assigned to an agent',
    contact_attempted: 'Contact attempted',
    status_changed: 'Status changed',
    converted: 'Converted to a client',
  };
  return map[event] ?? event.replace(/_/g, ' ');
}

// ── Overdue helper ─────────────────────────────────────────────────────────

/**
 * A lead is overdue when nobody has responded within the SLA. Configurable
 * rather than hard-coded, and expressed in hours because "4 hours" is a
 * decision someone should be able to change without reading code.
 */
export function isOverdue(
  submittedAt: string,
  firstResponseAt: string | null,
  slaHours = 4,
): boolean {
  if (firstResponseAt) return false;
  return Date.now() - new Date(submittedAt).getTime() > slaHours * 60 * 60 * 1000;
}

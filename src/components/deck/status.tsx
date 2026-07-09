import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Status indicators for the Instrument Deck.
 *
 * Accessibility floor: status is NEVER conveyed by color alone. Each state
 * pairs a hue with a distinct SHAPE (circle / ring / square / diamond) and
 * carries an aria-label, so it reads for color-blind users and screen
 * readers alike.
 */
export type DeckStatus =
  | 'active'
  | 'streaming'
  | 'armed'
  | 'profit'
  | 'idle'
  | 'queued'
  | 'pending'
  | 'warning'
  | 'error'
  | 'stale';

type Shape = 'circle' | 'ring' | 'square' | 'diamond';

interface StatusSpec {
  /** Tailwind text/border color token (drives the shape hue via currentColor). */
  tone: string;
  shape: Shape;
  /** Slow blink to signal "live / needs attention". */
  blink?: boolean;
  label: string;
}

const STATUS: Record<DeckStatus, StatusSpec> = {
  active: { tone: 'text-agent-active', shape: 'circle', label: 'Active' },
  streaming: { tone: 'text-agent-codex', shape: 'circle', blink: true, label: 'Streaming' },
  armed: { tone: 'text-neon-green', shape: 'circle', blink: true, label: 'Armed' },
  profit: { tone: 'text-neon-green', shape: 'circle', label: 'Positive' },
  idle: { tone: 'text-agent-idle', shape: 'ring', label: 'Idle' },
  queued: { tone: 'text-ink-low', shape: 'ring', label: 'Queued' },
  pending: { tone: 'text-gate', shape: 'diamond', blink: true, label: 'Action required' },
  warning: { tone: 'text-warning', shape: 'diamond', label: 'Warning' },
  error: { tone: 'text-destructive', shape: 'square', label: 'Error' },
  stale: { tone: 'text-ink-low', shape: 'square', label: 'Stale' },
};

const SHAPE_CLASS: Record<Shape, string> = {
  circle: 'rounded-full bg-current',
  ring: 'rounded-full border-[1.5px] border-current',
  square: 'rounded-[1px] bg-current',
  diamond: 'rounded-[1px] bg-current rotate-45',
};

export function StatusDot({
  status,
  size = 6,
  className,
}: {
  status: DeckStatus;
  size?: number;
  className?: string;
}) {
  const s = STATUS[status];
  return (
    <span
      role="img"
      aria-label={s.label}
      style={{ width: size, height: size }}
      className={cn(
        'inline-block flex-shrink-0',
        s.tone,
        SHAPE_CLASS[s.shape],
        s.blink && 'animate-dot-blink motion-reduce:animate-none',
        className,
      )}
    />
  );
}

/** Dot + uppercase mono label chip — the pill form used in headers/badges. */
export function StatusBadge({
  status,
  children,
  className,
}: {
  status: DeckStatus;
  children?: React.ReactNode;
  className?: string;
}) {
  const s = STATUS[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[6px] rounded-[3px] border border-border/70 bg-surface-2/60 px-[6px] py-[1px] font-mono text-[8px] font-bold uppercase tracking-[0.14em]',
        s.tone,
        className,
      )}
    >
      <StatusDot status={status} size={5} />
      <span>{children ?? s.label}</span>
    </span>
  );
}

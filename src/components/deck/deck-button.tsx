import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * DeckButton — instrument-deck control button.
 *
 * Encodes the full state set from Direction Board §1A (default / hover /
 * active / disabled / loading) in the deck's mono voice. Variants map to
 * semantic hues; the `gate` variant is the solid-fill APPROVE control and is
 * reserved for the rose approval gate. `danger` is the kill-switch red —
 * visually distinct from the gate on purpose.
 */
type Variant = 'primary' | 'gate' | 'reject' | 'danger' | 'ghost';
type Size = 'sm' | 'md';

const VARIANT: Record<Variant, string> = {
  // ice-blue instrument control
  primary:
    'border-primary/40 bg-primary/[0.08] text-primary-bright ' +
    'hover:border-primary hover:bg-primary/20 hover:text-[#bae6fd] ' +
    'active:bg-[#0e2740] active:text-primary active:shadow-[inset_0_1px_5px_rgba(0,0,0,0.5)]',
  // solid-fill rose APPROVE (approval gate only)
  gate:
    'border-gate bg-gate text-gate-foreground font-bold ' +
    'hover:bg-gate-soft hover:border-gate-soft ' +
    'active:brightness-90',
  // paired REJECT — quiet until hovered, then error-red
  reject:
    'border-ink-low/40 bg-transparent text-ink-mid ' +
    'hover:border-destructive/60 hover:text-destructive',
  // kill-switch destructive halt (NOT the gate)
  danger:
    'border-destructive/70 bg-destructive/15 text-destructive ' +
    'hover:bg-destructive/25 hover:border-destructive',
  ghost:
    'border-transparent bg-transparent text-ink-mid ' +
    'hover:bg-surface-3/60 hover:text-ink-hi',
};

const SIZE: Record<Size, string> = {
  sm: 'px-[10px] py-[5px] text-[9px]',
  md: 'px-[14px] py-[7px] text-[10px]',
};

export interface DeckButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** Optional leading glyph (e.g. ✓ / ✕ / ⏻). */
  glyph?: React.ReactNode;
}

export const DeckButton = React.forwardRef<HTMLButtonElement, DeckButtonProps>(function DeckButton(
  { variant = 'primary', size = 'md', loading = false, glyph, disabled, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-[6px] rounded border font-mono font-semibold uppercase tracking-[0.14em] transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary/80',
        'disabled:cursor-not-allowed disabled:border-ink-low/20 disabled:bg-ink-low/[0.03] disabled:text-[#3d4a5c] disabled:shadow-none',
        SIZE[size],
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden
          className="h-[9px] w-[9px] animate-spin rounded-full border-[1.5px] border-primary/35 border-t-primary-bright motion-reduce:animate-none"
        />
      ) : (
        glyph != null && <span aria-hidden>{glyph}</span>
      )}
      {children}
    </button>
  );
});

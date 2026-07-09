import * as React from 'react';
import { cn } from '@/lib/utils';
import { DeckButton } from './deck-button';
import { StatusDot } from './status';

/**
 * ApprovalGate — the highest-stakes surface in the system.
 *
 * The rose hue (#FF2D6B) appears NOWHERE else. A slow ~1.3s edge-pulse plus a
 * live "action required" dot carry the "this needs you" signal so it never
 * reads as a passive status chip (Direction Board §1A · Trading/Personal
 * Room mockups). This renders the inner pulsing action card; wrap it in a
 * <PanelChrome accent="gate" glow> for the rose-glowed column treatment.
 *
 * Accessibility: the card is an aria-live region, the tag pairs an icon-shape
 * with text (never color alone), and both controls are real buttons with the
 * deck focus ring. `pending={false}` freezes the pulse (already-resolved).
 */
export interface ApprovalGateProps {
  /** Order / action body (symbol, size, provenance chips, etc.). */
  children: React.ReactNode;
  onApprove?: () => void;
  onReject?: () => void;
  approveLabel?: React.ReactNode;
  rejectLabel?: React.ReactNode;
  /** Header tag copy. */
  tag?: string;
  /** Drives the edge-pulse + live dot. Default true. */
  pending?: boolean;
  /** Disables controls + shows the approve spinner while resolving. */
  busy?: boolean;
  className?: string;
}

export function ApprovalGate({
  children,
  onApprove,
  onReject,
  approveLabel = 'APPROVE',
  rejectLabel = 'REJECT',
  tag = 'AWAITING YOUR APPROVAL',
  pending = true,
  busy = false,
  className,
}: ApprovalGateProps) {
  return (
    <div
      role="group"
      aria-label={tag}
      aria-live="polite"
      className={cn(
        'flex flex-col gap-[9px] rounded-[5px] border border-gate/55 p-[12px]',
        'bg-[linear-gradient(180deg,hsl(var(--gate)/0.07),hsl(var(--gate)/0.02))]',
        pending && 'animate-gate-pulse motion-reduce:animate-none',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <StatusDot status="pending" size={6} />
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-gate">
          {tag}
        </span>
      </div>

      <div className="flex flex-col gap-[9px]">{children}</div>

      <div className="flex gap-2">
        <DeckButton
          variant="gate"
          size="md"
          glyph="✓"
          loading={busy}
          onClick={onApprove}
          className="flex-1"
        >
          {approveLabel}
        </DeckButton>
        <DeckButton
          variant="reject"
          size="md"
          glyph="✕"
          disabled={busy}
          onClick={onReject}
          className="flex-1"
        >
          {rejectLabel}
        </DeckButton>
      </div>
    </div>
  );
}

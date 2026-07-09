import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * DataChip — the small mono metadata pill used throughout the deck
 * (model / latency / ops, provenance, "½ Kelly · 2.1% of book", etc.).
 * Numeric content stays tabular. 11px floor is respected via the 8–9px
 * chip scale being metadata, not primary data.
 */
export function DataChip({
  children,
  tone = 'muted',
  className,
}: {
  children: React.ReactNode;
  tone?: 'muted' | 'primary' | 'agent' | 'dashed';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[3px] border px-[7px] py-[1px] font-mono text-[9px] tabular',
        tone === 'muted' && 'border-border/60 bg-surface-2/50 text-ink-mid',
        tone === 'primary' && 'border-primary/30 bg-primary/[0.06] text-primary-bright',
        tone === 'agent' && 'border-agent-codex/30 bg-agent-codex/[0.06] text-agent-codex',
        tone === 'dashed' && 'border-dashed border-ink-low/40 text-ink-low',
        className,
      )}
    >
      {children}
    </span>
  );
}

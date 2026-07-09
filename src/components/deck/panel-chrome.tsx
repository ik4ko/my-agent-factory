import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * PanelChrome — the Instrument Deck's signature panel treatment.
 *
 * `⌐ TITLE` bracketed header + four hairline corner brackets + a matte
 * surface. This is THE component applied identically to every panel in every
 * room (Direction Board §1A / Trading Room.dc.html). Do not hand-roll panel
 * frames elsewhere — compose this.
 *
 * Accent drives the semantic hue:
 *  - 'default' → ice-blue brackets, muted title (every normal instrument)
 *  - 'gate'    → rose, reserved for the approval gate ONLY
 *  - 'agent'   → CODEX purple (agent-scoped panels)
 */
type Accent = 'default' | 'gate' | 'agent';

const BRACKET: Record<Accent, string> = {
  default: 'border-primary/40',
  gate: 'border-gate/60',
  agent: 'border-agent-codex/50',
};

const TITLE_TONE: Record<Accent, string> = {
  default: 'text-[#4c6079]',
  gate: 'text-gate-soft',
  agent: 'text-agent-codex',
};

export interface PanelChromeProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  /** Header label — rendered uppercase after the ⌐ glyph. */
  title: React.ReactNode;
  /** Right-aligned header slot (summary text, filter chips, actions). */
  headerRight?: React.ReactNode;
  accent?: Accent;
  /** Render the four corner brackets (signature). Default true. */
  brackets?: boolean;
  /** Class for the scrolling body region. */
  bodyClassName?: string;
  /** When true, the panel column carries a rose glow (pending approval). */
  glow?: boolean;
  children?: React.ReactNode;
}

/** One corner bracket. `pos` picks which two edges get the hairline. */
function Bracket({ pos, tone }: { pos: 'tl' | 'tr' | 'bl' | 'br'; tone: string }) {
  const edge =
    pos === 'tl'
      ? 'top-[-1px] left-[-1px] border-t border-l'
      : pos === 'tr'
        ? 'top-[-1px] right-[-1px] border-t border-r'
        : pos === 'bl'
          ? 'bottom-[-1px] left-[-1px] border-b border-l'
          : 'bottom-[-1px] right-[-1px] border-b border-r';
  return <span aria-hidden className={cn('pointer-events-none absolute z-[1] h-3 w-3', edge, tone)} />;
}

export function PanelChrome({
  title,
  headerRight,
  accent = 'default',
  brackets = true,
  glow = false,
  className,
  bodyClassName,
  children,
  ...rest
}: PanelChromeProps) {
  return (
    <section
      className={cn(
        'relative flex min-h-0 flex-col rounded-[5px] border border-border/90 bg-surface-1',
        glow && 'shadow-gate-col',
        className,
      )}
      {...rest}
    >
      {brackets && (
        <>
          <Bracket pos="tl" tone={BRACKET[accent]} />
          <Bracket pos="tr" tone={BRACKET[accent]} />
          <Bracket pos="bl" tone={BRACKET[accent]} />
          <Bracket pos="br" tone={BRACKET[accent]} />
        </>
      )}

      <header className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-border/60 px-[9px] py-[6px]">
        <span
          className={cn(
            'select-none font-mono text-[9.5px] font-medium uppercase tracking-[0.2em]',
            TITLE_TONE[accent],
          )}
        >
          ⌐&nbsp;{title}
        </span>
        {headerRight != null && <div className="flex items-center gap-2">{headerRight}</div>}
      </header>

      <div className={cn('min-h-0 flex-1 overflow-y-auto p-2', bodyClassName)}>{children}</div>
    </section>
  );
}

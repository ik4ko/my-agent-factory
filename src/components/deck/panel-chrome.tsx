import * as React from 'react';
import { cn } from '@/lib/utils';
import { BorderBeam } from '@/components/ui/border-beam';

/**
 * PanelChrome — the Instrument Deck's signature panel treatment.
 *
 * `⌐ TITLE` bracketed header + top-left/top-right hairline corner brackets +
 * a matte gradient surface. This is THE component applied identically to
 * every panel in every room (HANDOFF_SPEC §3, Trading Dashboard.dc.html).
 * Do not hand-roll panel frames elsewhere — compose this.
 *
 * Accent drives the semantic hue:
 *  - 'default' → ice-violet brackets, muted title (every normal instrument)
 *  - 'gate'    → ice-violet, reserved for the approval gate (same hue as
 *                default now — HANDOFF_SPEC retires the rose gate)
 *  - 'agent'   → CODEX purple (agent-scoped panels)
 */
type Accent = 'default' | 'gate' | 'agent';

const BRACKET: Record<Accent, string> = {
  default: 'border-primary/35',
  gate: 'border-gate/35',
  agent: 'border-agent-codex/50',
};

const TITLE_TONE: Record<Accent, string> = {
  default: 'text-ink-label',
  gate: 'text-gate-soft',
  agent: 'text-agent-codex',
};

export interface PanelChromeProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  /** Header label — rendered uppercase after the ⌐ glyph. */
  title: React.ReactNode;
  /** Right-aligned header slot (summary text, filter chips, actions). */
  headerRight?: React.ReactNode;
  accent?: Accent;
  /** Render the top-left + top-right corner brackets (signature). Default true. */
  brackets?: boolean;
  /** ⌘K palette jump target — matches `[data-screen-label]`. Defaults to `title` when it's a string. */
  screenLabel?: string;
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
  screenLabel,
  className,
  bodyClassName,
  children,
  ...rest
}: PanelChromeProps) {
  return (
    <section
      data-screen-label={screenLabel ?? (typeof title === 'string' ? title : undefined)}
      className={cn(
        'relative flex min-h-0 flex-col rounded-[6px] border border-border/[0.08] bg-[image:var(--panel-gradient)]',
        glow && 'shadow-gate-col',
        className,
      )}
      {...rest}
    >
      {brackets && (
        <>
          <Bracket pos="tl" tone={BRACKET[accent]} />
          <Bracket pos="tr" tone={BRACKET[accent]} />
        </>
      )}
      {glow && <BorderBeam size={90} duration={7} colorFrom="#a3b1f7" colorTo="#8ec5ff" borderWidth={1} />}

      <header className="flex h-8 flex-shrink-0 items-center justify-between gap-2 border-b border-border/[0.06] px-3">
        <span className={cn('panel-label select-none', TITLE_TONE[accent])}>
          ⌐&nbsp;{title}
        </span>
        {headerRight != null && <div className="flex items-center gap-2">{headerRight}</div>}
      </header>

      <div className={cn('min-h-0 flex-1 overflow-y-auto p-2', bodyClassName)}>{children}</div>
    </section>
  );
}

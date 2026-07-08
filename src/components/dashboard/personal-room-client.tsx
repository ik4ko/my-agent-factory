'use client';

import Link from 'next/link';
import { Repeat, Settings } from 'lucide-react';
import { EmailComposer } from './email-composer';
import { TokenStream } from './token-stream';
import { WidgetErrorBoundary } from './widget-error-boundary';

/**
 * Personal Room — administrative control, metrics management, and client
 * tracking, isolated from the orchestration/trading context. Client comms via
 * the audited email composer; a metrics readout (24h token spend per lane);
 * and quick access to the utility routes (Loops, Settings) that live outside
 * the four rooms.
 */
export function PersonalRoomClient() {
  return (
    <div className="flex flex-col gap-4">
      <section>
        <h2 className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Client comms</h2>
        <WidgetErrorBoundary name="Email">
          <EmailComposer />
        </WidgetErrorBoundary>
      </section>

      <section>
        <h2 className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Metrics management · 24h spend</h2>
        <div className="h-[240px] rounded-md surface-glass p-3">
          <WidgetErrorBoundary name="Token Stream">
            <TokenStream />
          </WidgetErrorBoundary>
        </div>
      </section>

      <section>
        <h2 className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Administrative control</h2>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/dashboard/settings"
            className="flex items-center gap-1.5 rounded-md surface-glass hairline px-3 py-1.5 font-terminal text-[10px] text-foreground/80 transition-colors hover:text-foreground"
          >
            <Settings className="size-3 text-neon-cyan" aria-hidden /> Settings · model matrix &amp; connections
          </Link>
          <Link
            href="/dashboard/loops"
            className="flex items-center gap-1.5 rounded-md surface-glass hairline px-3 py-1.5 font-terminal text-[10px] text-foreground/80 transition-colors hover:text-foreground"
          >
            <Repeat className="size-3 text-neon-purple" aria-hidden /> Loops · authoring &amp; triggers
          </Link>
        </div>
      </section>
    </div>
  );
}

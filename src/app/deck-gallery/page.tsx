import {
  PanelChrome,
  DeckButton,
  StatusDot,
  StatusBadge,
  ApprovalGate,
  DataChip,
  type DeckStatus,
} from '@/components/deck';

/**
 * Instrument Deck — component gallery.
 *
 * Not a product route: a visual consistency harness for Design System 1A,
 * screenshotted against Direction Board.dc.html §1A during the build. Lives
 * outside the middleware matcher so it renders without auth.
 */
const STATUSES: DeckStatus[] = [
  'active', 'streaming', 'armed', 'profit', 'idle', 'queued', 'pending', 'warning', 'error', 'stale',
];

export default function DeckGallery() {
  return (
    <main className="min-h-full overflow-y-auto bg-background p-8 font-body text-ink-hi">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <header className="flex flex-col gap-1">
          <span className="font-mono text-[10px] tracking-[0.34em] text-ink-low">
            INSTRUMENT DECK · DESIGN SYSTEM 1A
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">Component Reference</h1>
        </header>

        {/* Panel chrome variants */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <PanelChrome title="EXECUTION SAFETY" headerRight={<StatusBadge status="armed">ARMED</StatusBadge>}>
            <p className="p-1 text-[11px] leading-relaxed text-ink-mid">
              Default instrument panel with ⌐ header + four corner brackets.
            </p>
          </PanelChrome>
          <PanelChrome title="RUNS · CODEX" accent="agent" headerRight={<span className="font-mono text-[9px] text-ink-low">3 RUNNING</span>}>
            <p className="p-1 text-[11px] leading-relaxed text-ink-mid">Agent-scoped panel (CODEX purple accent).</p>
          </PanelChrome>
          <PanelChrome title="STAGED ORDERS" accent="gate" glow headerRight={<StatusBadge status="pending">1 PENDING</StatusBadge>}>
            <p className="p-1 text-[11px] leading-relaxed text-ink-mid">Gate-accented column with rose glow.</p>
          </PanelChrome>
        </div>

        {/* Buttons — all variants + states */}
        <PanelChrome title="CONTROLS" bodyClassName="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <DeckButton variant="primary" glyph="▶">RUN</DeckButton>
            <DeckButton variant="primary" loading>RUN</DeckButton>
            <DeckButton variant="primary" disabled>RUN</DeckButton>
            <DeckButton variant="gate" glyph="✓">APPROVE</DeckButton>
            <DeckButton variant="reject" glyph="✕">REJECT</DeckButton>
            <DeckButton variant="danger" glyph="⏻">KILL SWITCH</DeckButton>
            <DeckButton variant="ghost">DISMISS</DeckButton>
          </div>
        </PanelChrome>

        {/* Status indicators */}
        <PanelChrome title="STATUS INDICATORS" bodyClassName="p-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-4">
              {STATUSES.map((s) => (
                <span key={s} className="inline-flex items-center gap-2">
                  <StatusDot status={s} size={8} />
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-mid">{s}</span>
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((s) => (
                <StatusBadge key={s} status={s} />
              ))}
            </div>
          </div>
        </PanelChrome>

        {/* The rose gate */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <PanelChrome title="STAGED ORDERS" accent="gate" glow>
            <ApprovalGate tag="AWAITING YOUR APPROVAL">
              <div className="flex items-center gap-2 font-mono">
                <span className="rounded-[3px] border border-neon-green/45 bg-neon-green/10 px-2 py-[2px] text-[9px] font-bold tracking-[0.14em] text-neon-green">
                  BUY
                </span>
                <span className="text-[14px] font-bold text-ink-hi">40 NVDA</span>
                <span className="text-[11px] text-ink-mid">@ MKT</span>
                <span className="ml-auto text-[11px] tabular text-ink-mid">est $7,284</span>
              </div>
              <div className="flex flex-wrap gap-[6px]">
                <DataChip>½ Kelly · 2.1% of book</DataChip>
                <DataChip>GROK signal conf 0.82</DataChip>
                <DataChip tone="agent">staged by CODEX</DataChip>
              </div>
            </ApprovalGate>
          </PanelChrome>

          <PanelChrome title="DATA CHIPS" bodyClassName="p-4">
            <div className="flex flex-wrap gap-2">
              <DataChip>opus-4</DataChip>
              <DataChip>420ms</DataChip>
              <DataChip>1,204 ops</DataChip>
              <DataChip tone="primary">+142.10</DataChip>
              <DataChip tone="agent">CODEX</DataChip>
              <DataChip tone="dashed">telemetry pending</DataChip>
            </div>
          </PanelChrome>
        </div>
      </div>
    </main>
  );
}

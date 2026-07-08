'use client';

import { useEffect, useMemo, useState } from 'react';
import { Reorder } from 'framer-motion';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { EyeOff, Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import { AgentFleet } from './agent-fleet';
import { AgentChat } from './agent-chat';
import { ConsensusView } from './consensus-view';
import { TokenStream } from './token-stream';
import { TaskFeed } from './task-feed';
import { LiveTerminal } from './live-terminal';
import { MemoryViewer } from './memory-viewer';
import { StagedOrders } from './staged-orders';
import { OmnigentActivity } from './omnigent-activity';
import { WidgetErrorBoundary } from './widget-error-boundary';
import type { Agent, Task, Log } from '@/lib/types/database.types';
import { cn } from '@/lib/utils';

const PANE_IDS = ['orchestrate', 'fleet', 'tasks', 'terminal', 'consensus', 'tokens', 'memory', 'omnigent'] as const;
export type PaneId = (typeof PANE_IDS)[number];

const PANE_LABEL: Record<PaneId, string> = {
  orchestrate: 'Main Chat',
  fleet: 'Fleet',
  tasks: 'Tasks & Approvals',
  consensus: 'Consensus',
  tokens: 'Tokens',
  terminal: 'Terminal',
  memory: 'Memory',
  omnigent: 'Omnigent',
};

const PANE_ACCENT: Record<PaneId, string> = {
  orchestrate: 'text-primary',
  fleet: 'text-neon-green',
  tasks: 'text-warning',
  consensus: 'text-primary',
  tokens: 'text-neon-green',
  terminal: 'text-neon-cyan',
  memory: 'text-neon-purple',
  omnigent: 'text-neon-cyan',
};

// Consensus + Tokens + Omnigent start hidden — opt-in surfaces, not part of
// the default tiling. Users bring them in from the tab strip.
const DEFAULT_HIDDEN: PaneId[] = ['consensus', 'tokens', 'omnigent'];

const LS_KEY = 'deck.layout.v1';

interface DeckState {
  order: PaneId[];
  hidden: PaneId[];
}

const DEFAULT_STATE: DeckState = { order: [...PANE_IDS], hidden: [...DEFAULT_HIDDEN] };

function loadState(): DeckState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<DeckState>;
    const order = (parsed.order ?? []).filter((id): id is PaneId => (PANE_IDS as readonly string[]).includes(id));
    for (const id of PANE_IDS) if (!order.includes(id)) order.push(id); // new panes join at the end
    const hidden = (parsed.hidden ?? []).filter((id): id is PaneId => (PANE_IDS as readonly string[]).includes(id));
    return { order, hidden };
  } catch {
    return DEFAULT_STATE;
  }
}

/** Chunk visible panes into balanced rows of at most three. */
function chunkRows(visible: PaneId[]): PaneId[][] {
  if (visible.length <= 3) return [visible];
  const split = Math.ceil(visible.length / 2);
  return [visible.slice(0, split), visible.slice(split)];
}

/** Main Chat is the dominant front-page surface: when visible it always gets
 *  its own full-width top row (sized larger in the render pass below), with
 *  every other visible pane chunked into the rows beneath it. */
function toRows(visible: PaneId[]): PaneId[][] {
  if (!visible.includes('orchestrate')) return chunkRows(visible);
  const rest = visible.filter((id) => id !== 'orchestrate');
  return rest.length === 0 ? [['orchestrate']] : [['orchestrate'], ...chunkRows(rest)];
}

function HandleH() {
  return (
    <PanelResizeHandle className="group relative flex w-1 cursor-col-resize items-center justify-center bg-border/0 transition-colors hover:bg-primary/20">
      <div className="h-8 w-px rounded-full bg-border transition-colors group-hover:bg-primary/40" />
    </PanelResizeHandle>
  );
}
function HandleV() {
  return (
    <PanelResizeHandle className="group relative flex h-1 cursor-row-resize items-center justify-center bg-border/0 transition-colors hover:bg-primary/20">
      <div className="h-px w-8 rounded-full bg-border transition-colors group-hover:bg-primary/40" />
    </PanelResizeHandle>
  );
}

/**
 * Multi-pane workspace deck — browser-tab semantics over the command
 * horizon. The chip strip is the window manager: drag chips to reorder
 * panes, click to toggle a pane in/out of the tiling, maximize any pane to
 * solo view. Arrangement persists per browser (localStorage). All panes stay
 * live simultaneously; the tiling is strictly container-bound.
 */
export function WorkspaceDeck({
  initialAgents,
  initialTasks,
  initialLogs,
}: {
  initialAgents: Agent[];
  initialTasks: Task[];
  initialLogs: Log[];
}) {
  const [order, setOrder] = useState<PaneId[]>(DEFAULT_STATE.order);
  const [hidden, setHidden] = useState<PaneId[]>(DEFAULT_STATE.hidden);
  const [maximized, setMaximized] = useState<PaneId | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // localStorage only after mount — SSR and first client paint must agree.
  useEffect(() => {
    const s = loadState();
    setOrder(s.order);
    setHidden(s.hidden);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ order, hidden } satisfies DeckState));
    } catch {
      /* storage unavailable — layout is session-only */
    }
  }, [order, hidden, hydrated]);

  const toggle = (id: PaneId) => {
    setMaximized(null);
    setHidden((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]));
  };

  // Double-click a chip → force the pane shown and solo it, regardless of the
  // two single-click toggles the browser fires first (they cancel out).
  const handleMaximize = (id: PaneId) => {
    setHidden((h) => h.filter((x) => x !== id));
    setMaximized(id);
  };

  const visible = useMemo(() => order.filter((id) => !hidden.includes(id)), [order, hidden]);
  const rows = useMemo(() => toRows(visible), [visible]);
  const rowSizes = useMemo(() => computeRowSizes(rows), [rows]);

  const paneBody = (id: PaneId) => {
    switch (id) {
      case 'fleet':
        return <AgentFleet initialAgents={initialAgents} dense />;
      case 'tasks':
        // Task running state + manual-approval queue, unified: staged orders
        // render nothing when the queue is empty, so this costs no extra
        // layout until there's actually something to approve.
        return (
          <div className="flex h-full flex-col gap-2">
            <div className="min-h-0 flex-1 overflow-hidden">
              <TaskFeed initialTasks={initialTasks} />
            </div>
            <StagedOrders />
          </div>
        );
      case 'orchestrate':
        return <AgentChat variant="panel" />;
      case 'consensus':
        return <ConsensusView />;
      case 'tokens':
        return <TokenStream />;
      case 'terminal':
        return <LiveTerminal initialLogs={initialLogs} />;
      case 'memory':
        return <MemoryViewer />;
      case 'omnigent':
        return <OmnigentActivity />;
    }
  };

  const pane = (id: PaneId) => (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-2.5">
      <div className="mb-1 flex shrink-0 items-center gap-1.5">
        <span className={cn('font-terminal text-[9px] font-bold uppercase tracking-[0.15em]', PANE_ACCENT[id])}>
          {PANE_LABEL[id]}
        </span>
        <button
          onClick={() => setMaximized((m) => (m === id ? null : id))}
          aria-label={maximized === id ? `Restore ${PANE_LABEL[id]} to the grid` : `Maximize ${PANE_LABEL[id]}`}
          title={maximized === id ? 'Restore grid' : 'Solo this pane'}
          className="ml-auto rounded p-0.5 text-muted-foreground/30 transition-colors hover:text-foreground"
        >
          {maximized === id ? <Minimize2 className="size-2.5" /> : <Maximize2 className="size-2.5" />}
        </button>
        <button
          onClick={() => toggle(id)}
          aria-label={`Hide ${PANE_LABEL[id]} pane`}
          title="Hide pane (reopen from the tab strip)"
          className="rounded p-0.5 text-muted-foreground/30 transition-colors hover:text-foreground"
        >
          <EyeOff className="size-2.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <WidgetErrorBoundary name={PANE_LABEL[id]}>{paneBody(id)}</WidgetErrorBoundary>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* tab strip — the window manager */}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-surface-1/40 px-2 py-1">
        <Reorder.Group axis="x" values={order} onReorder={setOrder} className="flex items-center gap-1">
          {order.map((id) => {
            const on = !hidden.includes(id);
            return (
              <Reorder.Item key={id} value={id} className="list-none">
                <button
                  onClick={() => toggle(id)}
                  onDoubleClick={() => handleMaximize(id)}
                  aria-pressed={on}
                  title={`${on ? 'Hide' : 'Show'} ${PANE_LABEL[id]} · double-click to maximize · drag to reorder`}
                  className={cn(
                    'flex cursor-grab items-center gap-1.5 rounded-md border px-2 py-0.5 font-terminal text-[10px] transition-colors active:cursor-grabbing',
                    on
                      ? cn('border-border bg-surface-2', PANE_ACCENT[id])
                      : 'border-border/40 text-muted-foreground/35 hover:text-muted-foreground/70'
                  )}
                >
                  <span className={cn('size-1 rounded-full', on ? 'bg-current' : 'bg-muted-foreground/25')} aria-hidden />
                  {PANE_LABEL[id]}
                </button>
              </Reorder.Item>
            );
          })}
        </Reorder.Group>
        {(hidden.length > 0 || maximized) && (
          <button
            onClick={() => {
              setHidden([]);
              setMaximized(null);
            }}
            title="Restore all panes to the grid"
            className="ml-auto flex shrink-0 items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 font-terminal text-[9px] text-muted-foreground/50 transition-colors hover:text-foreground"
          >
            <RotateCcw className="size-2.5" aria-hidden /> reset
          </button>
        )}
      </div>

      {/* tiling */}
      {maximized ? (
        <div className="min-h-0 flex-1">{pane(maximized)}</div>
      ) : visible.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <span className="font-terminal text-xs text-muted-foreground/40">
            All panes hidden — click a tab above to bring one back.
          </span>
        </div>
      ) : (
        <PanelGroup key={visible.join('|')} direction="vertical" className="min-h-0 flex-1 overflow-hidden">
          {rows.map((row, rowIdx) => (
            <PaneRow
              key={row.join('|')}
              row={row}
              rowIdx={rowIdx}
              defaultSize={rowSizes[rowIdx]}
              pane={pane}
            />
          ))}
        </PanelGroup>
      )}
    </div>
  );
}

/** Chat's own row (when present) dominates the vertical split; the rest
 *  share what's left evenly. */
function computeRowSizes(rows: PaneId[][]): number[] {
  const isDominantChatRow = rows.length > 1 && rows[0].length === 1 && rows[0][0] === 'orchestrate';
  if (!isDominantChatRow) return rows.map(() => 100 / rows.length);
  const restCount = rows.length - 1;
  return [55, ...Array.from({ length: restCount }, () => 45 / restCount)];
}

function PaneRow({
  row,
  rowIdx,
  defaultSize,
  pane,
}: {
  row: PaneId[];
  rowIdx: number;
  defaultSize: number;
  pane: (id: PaneId) => React.ReactNode;
}) {
  return (
    <>
      {rowIdx > 0 && <HandleV />}
      <Panel defaultSize={defaultSize} minSize={18}>
        <PanelGroup direction="horizontal" className="h-full">
          {row.map((id, colIdx) => (
            <PaneCell key={id} id={id} colIdx={colIdx} colCount={row.length} pane={pane} />
          ))}
        </PanelGroup>
      </Panel>
    </>
  );
}

function PaneCell({
  id,
  colIdx,
  colCount,
  pane,
}: {
  id: PaneId;
  colIdx: number;
  colCount: number;
  pane: (id: PaneId) => React.ReactNode;
}) {
  return (
    <>
      {colIdx > 0 && <HandleH />}
      <Panel defaultSize={100 / colCount} minSize={15} className={cn(colIdx > 0 && 'border-l border-border/40')}>
        {pane(id)}
      </Panel>
    </>
  );
}

'use client';

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Move } from 'lucide-react';
import {
  ResponsiveGridLayout,
  useContainerWidth,
  verticalCompactor,
  type Layout,
  type LayoutItem,
  type ResponsiveLayouts,
} from 'react-grid-layout';
import { cn } from '@/lib/utils';

/**
 * Shared draggable-panel engine (react-grid-layout v2), applied per room.
 *
 * Contract:
 *  - Drag starts ONLY from a panel's PanelChrome <header> (dragConfig.handle);
 *    interactive elements cancel drags so inputs/charts never fight the grid.
 *  - Layouts persist per room + breakpoint to workspace_layouts (debounced).
 *  - Keyboard alternative: each panel gets a focusable grip — arrows move,
 *    shift+arrows resize, one grid unit per press.
 */

export const GRID_BREAKPOINTS = { lg: 1100, md: 700, sm: 0 } as const;
export const GRID_COLS = { lg: 12, md: 8, sm: 1 } as const;
type BreakpointId = keyof typeof GRID_COLS;

const SAVE_DEBOUNCE_MS = 800;
const DRAG_CANCEL = 'input,textarea,select,button,a,canvas,[data-grid-nodrag]';

export interface WorkspacePanelDef {
  id: string;
  /** Accessible name for the keyboard grip ("Move CHART panel"). */
  label: string;
  node: React.ReactNode;
}

type EditableLayouts = Record<BreakpointId, LayoutItem[]>;

export function WorkspaceGrid({
  room,
  panels,
  defaultLayouts,
  rowHeight = 40,
}: {
  room: 'trading' | 'coding' | 'personal' | 'hub' | 'youtube';
  panels: WorkspacePanelDef[];
  defaultLayouts: EditableLayouts;
  rowHeight?: number;
}) {
  const { width, mounted, containerRef } = useContainerWidth();
  const [layouts, setLayouts] = useState<EditableLayouts>(defaultLayouts);
  const [loaded, setLoaded] = useState(false);
  const [breakpoint, setBreakpoint] = useState<BreakpointId>('lg');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load persisted layouts once; stored breakpoints win over defaults, and
  // panels added since the save keep their default placement.
  useEffect(() => {
    let alive = true;
    fetch(`/api/workspace-layouts?room=${room}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : { layouts: {} }))
      .then((data: { layouts?: Partial<Record<BreakpointId, LayoutItem[]>> }) => {
        if (!alive) return;
        const stored = data.layouts ?? {};
        setLayouts((defaults) => {
          const merged: EditableLayouts = { ...defaults };
          for (const bp of Object.keys(stored) as BreakpointId[]) {
            const saved = stored[bp] ?? [];
            const savedIds = new Set(saved.map((item) => item.i));
            const missing = (defaults[bp] ?? []).filter((item) => !savedIds.has(item.i));
            merged[bp] = [...saved.filter((item) => panels.some((p) => p.id === item.i)), ...missing];
          }
          return merged;
        });
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
    // panels identity is stable per room; room never changes at runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  const persist = useCallback(
    (bp: BreakpointId, layout: readonly LayoutItem[]) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void fetch('/api/workspace-layouts', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            room,
            breakpoint: bp,
            layout: layout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h })),
          }),
        }).catch(() => undefined);
      }, SAVE_DEBOUNCE_MS);
    },
    [room],
  );

  const onLayoutChange = useCallback(
    (current: Layout, all: ResponsiveLayouts<BreakpointId>) => {
      if (!loaded) return; // ignore the pre-hydration churn
      setLayouts((prev) => ({ ...prev, ...(all as Partial<EditableLayouts>) }) as EditableLayouts);
      persist(breakpoint, current as LayoutItem[]);
    },
    [breakpoint, loaded, persist],
  );

  /** Keyboard move/resize: one grid unit per arrow press on a panel's grip. */
  const onGripKeyDown = useCallback(
    (panelId: string) => (e: React.KeyboardEvent) => {
      const deltas: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const delta = deltas[e.key];
      if (!delta) return;
      e.preventDefault();
      e.stopPropagation();
      const cols = GRID_COLS[breakpoint];
      setLayouts((prev) => {
        const layout = prev[breakpoint] ?? [];
        const next = layout.map((item) => {
          if (item.i !== panelId) return item;
          if (e.shiftKey) {
            const w = Math.max(1, Math.min(cols - item.x, item.w + delta[0]));
            const h = Math.max(2, item.h + delta[1]);
            return { ...item, w, h };
          }
          const x = Math.max(0, Math.min(cols - item.w, item.x + delta[0]));
          const y = Math.max(0, item.y + delta[1]);
          return { ...item, x, y };
        });
        persist(breakpoint, next);
        return { ...prev, [breakpoint]: next };
      });
    },
    [breakpoint, persist],
  );

  const children = useMemo(
    () =>
      panels.map((panel) => (
        <div key={panel.id} className="relative">
          {panel.node}
          <button
            type="button"
            data-grid-nodrag
            onKeyDown={onGripKeyDown(panel.id)}
            title={`${panel.label}: arrows move · shift+arrows resize`}
            aria-label={`Move or resize the ${panel.label} panel with arrow keys (hold shift to resize)`}
            className={cn(
              'absolute right-1.5 top-1 z-10 rounded p-0.5 text-muted-foreground/40',
              'opacity-0 transition-opacity focus:opacity-100 focus:outline focus:outline-1 focus:outline-primary/60',
              'hover:opacity-100',
            )}
          >
            <Move className="size-2.5" aria-hidden />
          </button>
        </div>
      )),
    [onGripKeyDown, panels],
  );

  return (
    <div ref={containerRef} className={cn('workspace-grid', !loaded && 'pointer-events-none opacity-60')}>
      {mounted && (
        <ResponsiveGridLayout
          width={width}
          layouts={layouts}
          breakpoints={GRID_BREAKPOINTS}
          cols={GRID_COLS}
          rowHeight={rowHeight}
          margin={[8, 8]}
          dragConfig={{ handle: 'header', cancel: DRAG_CANCEL }}
          compactor={verticalCompactor}
          onBreakpointChange={(bp) => setBreakpoint(bp)}
          onLayoutChange={onLayoutChange}
        >
          {children}
        </ResponsiveGridLayout>
      )}
    </div>
  );
}

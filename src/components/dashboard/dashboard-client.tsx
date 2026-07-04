'use client';

import { useState, useEffect, useCallback } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { AgentFleet } from './agent-fleet';
import { TaskFeed } from './task-feed';
import { LiveTerminal } from './live-terminal';
import { StatsBar } from './stats-bar';
import { MetricsBar } from './metrics-bar';
import { CommandPalette } from './command-palette';
import { TaskInput } from './task-input';
import { MemoryViewer } from './memory-viewer';
import { WidgetErrorBoundary } from './widget-error-boundary';
import { ConnectionBanner } from './connection-banner';
import { CommandConsole } from './command-console';
import { useCommandStore } from '@/lib/cli/command-store';
import { useWorkspaceInit } from '@/hooks/use-workspace-init';
import type { Agent, Task, Log } from '@/lib/types/database.types';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { CinematicCore } from './cinematic-core';

const HANDLE_CLS = cn(
  'relative flex items-center justify-center',
  'bg-border/0 transition-colors duration-150',
  'hover:bg-primary/20 active:bg-primary/30',
  'data-[resize-handle-active]:bg-primary/25',
  'group'
);

function HResizeHandle() {
  return (
    <PanelResizeHandle className={cn(HANDLE_CLS, 'w-1 cursor-col-resize')}>
      <div className="h-8 w-px bg-border group-hover:bg-primary/40 group-data-[resize-handle-active]:bg-primary/60 transition-colors duration-150 rounded-full" />
    </PanelResizeHandle>
  );
}

function VResizeHandle() {
  return (
    <PanelResizeHandle className={cn(HANDLE_CLS, 'h-1 cursor-row-resize')}>
      <div className="w-8 h-px bg-border group-hover:bg-primary/40 group-data-[resize-handle-active]:bg-primary/60 transition-colors duration-150 rounded-full" />
    </PanelResizeHandle>
  );
}

interface DashboardClientProps {
  initialAgents: Agent[];
  initialTasks: Task[];
  initialLogs: Log[];
}

export function DashboardClient({ initialAgents, initialTasks, initialLogs }: DashboardClientProps) {
  const [cmdOpen, setCmdOpen] = useState(false);
  const openConsole = useCommandStore((s) => s.setOpen);
  const qc = useQueryClient();

  // Hydrate the workspace: synchronous SSR seed (no layout shift) + parallel
  // reconcile fetch across all query keys, so tab re-entry is instant.
  useWorkspaceInit({ initial: { agents: initialAgents, tasks: initialTasks, logs: initialLogs } });

  // Global keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'k') { e.preventDefault(); setCmdOpen((v) => !v); return; }
      if (e.key === '/' && !mod) {
        const el = document.activeElement;
        const typing = el instanceof HTMLElement &&
          (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
        if (!typing) { e.preventDefault(); openConsole(true); return; }
      }
      if (e.key === 'Escape') { setCmdOpen(false); return; }
      if (e.key === 'r' && mod) { e.preventDefault(); qc.invalidateQueries(); return; }
    },
    [qc, openConsole]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <>
      {/* Neural power-grid background — sits behind all panels (-z-10 inside
          the page's `isolate` context), never intercepts pointer events. */}
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-50" aria-hidden="true">
        <CinematicCore isListening={false} focusTarget={null} intensity={1} />
      </div>

      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
      <CommandConsole />

      {/* Stats bar - live fleet health summary */}
      <WidgetErrorBoundary name="Stats">
        <StatsBar />
      </WidgetErrorBoundary>

      {/* Ecosystem metrics — 24h token spend, est cost, Fable cap meter */}
      <WidgetErrorBoundary name="Metrics">
        <MetricsBar />
      </WidgetErrorBoundary>

      {/* Resizable three-panel layout */}
      <PanelGroup direction="vertical" className="flex-1 overflow-hidden">
        {/* Top row: Agent Fleet + Task Feed */}
        <Panel defaultSize={55} minSize={25}>
          <PanelGroup direction="horizontal" className="h-full">
            <Panel defaultSize={42} minSize={22}>
              <div className="h-full overflow-hidden border-r border-border p-3">
                <WidgetErrorBoundary name="Agent Fleet">
                  <AgentFleet initialAgents={initialAgents} />
                </WidgetErrorBoundary>
              </div>
            </Panel>

            <HResizeHandle />

            <Panel defaultSize={58} minSize={28}>
              <div className="h-full overflow-hidden p-3">
                <WidgetErrorBoundary name="Task Feed">
                  <TaskFeed initialTasks={initialTasks} />
                </WidgetErrorBoundary>
              </div>
            </Panel>
          </PanelGroup>
        </Panel>

        <VResizeHandle />

        {/* Bottom row: Log Terminal + Memory Viewer */}
        <Panel defaultSize={45} minSize={20}>
          <PanelGroup direction="horizontal" className="h-full">
            <Panel defaultSize={65} minSize={35}>
              <div className="h-full overflow-hidden border-t border-border p-3">
                <WidgetErrorBoundary name="Live Terminal">
                  <LiveTerminal initialLogs={initialLogs} />
                </WidgetErrorBoundary>
              </div>
            </Panel>

            <HResizeHandle />

            <Panel defaultSize={35} minSize={22}>
              <div className="h-full overflow-hidden border-t border-l border-border p-3">
                <WidgetErrorBoundary name="Memory">
                  <MemoryViewer />
                </WidgetErrorBoundary>
              </div>
            </Panel>
          </PanelGroup>
        </Panel>
      </PanelGroup>

      {/* Realtime degraded-state toast (overlay, non-shifting) */}
      <ConnectionBanner />

      {/* Single terminal command dock — queues a pending task (lane-router flow) */}
      <TaskInput />
    </>
  );
}

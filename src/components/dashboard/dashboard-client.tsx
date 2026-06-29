'use client';

import { useState, useEffect, useCallback } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { AgentFleet } from './agent-fleet';
import { TaskFeed } from './task-feed';
import { LogTerminal } from './log-terminal';
import { StatsBar } from './stats-bar';
import { CommandPalette } from './command-palette';
import { HermesInput } from './hermes-input';
import type { Agent, Task, Log } from '@/lib/types/database.types';
import { useQueryClient } from '@tanstack/react-query';
import { AGENTS_KEY } from '@/hooks/use-agents-query';
import { TASKS_KEY } from '@/hooks/use-tasks-query';
import { LOGS_KEY } from '@/hooks/use-logs-query';
import { cn } from '@/lib/utils';

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
  const qc = useQueryClient();

  // Pre-populate query cache from SSR data
  useEffect(() => {
    if (initialAgents.length > 0) qc.setQueryData(AGENTS_KEY, initialAgents);
    if (initialTasks.length > 0) qc.setQueryData(TASKS_KEY, initialTasks);
    if (initialLogs.length > 0) qc.setQueryData(LOGS_KEY, initialLogs);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Global keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'k') { e.preventDefault(); setCmdOpen((v) => !v); return; }
      if (e.key === 'Escape') { setCmdOpen(false); return; }
      if (e.key === 'r' && mod) { e.preventDefault(); qc.invalidateQueries(); return; }
    },
    [qc]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <>
      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />

      {/* Stats bar — live fleet health summary */}
      <StatsBar />

      {/* Resizable three-panel layout */}
      <PanelGroup direction="vertical" className="flex-1 overflow-hidden">
        {/* Top row: Agent Fleet + Task Feed */}
        <Panel defaultSize={55} minSize={25}>
          <PanelGroup direction="horizontal" className="h-full">
            <Panel defaultSize={42} minSize={22}>
              <div className="h-full overflow-hidden border-r border-border p-4">
                <AgentFleet initialAgents={initialAgents} />
              </div>
            </Panel>

            <HResizeHandle />

            <Panel defaultSize={58} minSize={28}>
              <div className="h-full overflow-hidden p-4">
                <TaskFeed initialTasks={initialTasks} />
              </div>
            </Panel>
          </PanelGroup>
        </Panel>

        <VResizeHandle />

        {/* Bottom row: Log Terminal */}
        <Panel defaultSize={45} minSize={20}>
          <div className="h-full overflow-hidden border-t border-border p-4">
            <LogTerminal initialLogs={initialLogs} />
          </div>
        </Panel>
      </PanelGroup>

      {/* Hermes command bar */}
      <HermesInput />
    </>
  );
}

'use client';

import { useState, useEffect, useCallback } from 'react';
import { MetricsBar } from './metrics-bar';
import { RoomStatusStrip } from './room-status-strip';
import { CommandPalette } from './command-palette';
import { TaskInput } from './task-input';
import { WorkspaceDeck } from './workspace-deck';
import { WidgetErrorBoundary } from './widget-error-boundary';
import { ConnectionBanner } from './connection-banner';
import { CommandConsole } from './command-console';
import { useCommandStore } from '@/lib/cli/command-store';
import { useAgentSocket } from '@/hooks/use-agent-socket';
import { useWorkspaceInit } from '@/hooks/use-workspace-init';
import type { Agent, Task, Log } from '@/lib/types/database.types';
import { useQueryClient } from '@tanstack/react-query';
import { CinematicCore } from './cinematic-core';

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
  useAgentSocket();

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
      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
      <CommandConsole />

      {/* Single coherent metrics strip — fleet, tasks, log rate, spend, Fable cap */}
      <WidgetErrorBoundary name="Metrics">
        <MetricsBar />
      </WidgetErrorBoundary>

      {/* Cross-room overview — one status chip per room; the full trading
          chrome (simulation banner, risk panel) lives in /dashboard/rooms/trading */}
      <WidgetErrorBoundary name="Rooms">
        <RoomStatusStrip />
      </WidgetErrorBoundary>

      {/* Multi-pane workspace deck: every orchestration surface on one screen,
          window-managed by the chip strip (drag to reorder, click to toggle,
          maximize to solo). */}
      <WidgetErrorBoundary name="Workspace Deck">
        <WorkspaceDeck initialAgents={initialAgents} initialTasks={initialTasks} initialLogs={initialLogs} />
      </WidgetErrorBoundary>

      {/* Realtime degraded-state toast (overlay, non-shifting) */}
      <ConnectionBanner />

      {/* BACKGROUND GRAPHICS: Floating WebGL Particle Field */}
      <div className="absolute inset-0 z-0 pointer-events-none opacity-40 mix-blend-screen">
        <CinematicCore isListening={false} focusTarget={null} intensity={1} />
      </div>

      {/* Single terminal command dock — queues a pending task (lane-router flow) */}
      <TaskInput />
    </>
  );
}

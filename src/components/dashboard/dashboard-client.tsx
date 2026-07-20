'use client';

import { useState, useEffect, useCallback } from 'react';
import { CommandPalette } from './command-palette';
import { AgentChat, type AgentChatLane } from './agent-chat';
import { ChatHistoryPanel } from './chat-history-panel';
import { WidgetErrorBoundary } from './widget-error-boundary';
import { ConnectionBanner } from './connection-banner';
import { CommandConsole } from './command-console';
import { PanelChrome } from '@/components/deck';
import { useCommandStore } from '@/lib/cli/command-store';
import { useAgentSocket } from '@/hooks/use-agent-socket';
import { useWorkspaceInit } from '@/hooks/use-workspace-init';
import type { Agent, Task, Log } from '@/lib/types/database.types';
import { useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { NumberTicker } from '@/components/ui/number-ticker';
import TiltedCard from '@/components/TiltedCard';

// The Brain Hub WebGL scene touches window/canvas — client-only, and the ONE
// Three.js surface on the dashboard.
const SpatialWorkspace = dynamic(() => import('./SpatialWorkspace'), {
  ssr: false,
  loading: () => <div className="h-[420px] shrink-0 animate-pulse rounded-md border border-border bg-surface-2/40" />,
});

interface DashboardClientProps {
  initialAgents: Agent[];
  initialTasks: Task[];
  initialLogs: Log[];
}

export function DashboardClient({ initialAgents, initialTasks, initialLogs }: DashboardClientProps) {
  const [cmdOpen, setCmdOpen] = useState(false);
  const [hubLane, setHubLane] = useState<AgentChatLane>('CLAUDE');
  const openConsole = useCommandStore((s) => s.setOpen);
  const qc = useQueryClient();

  const selectSpatialBrain = useCallback((brainKey: string) => {
    // Future planets can focus visually, but they must not re-enable paid
    // future-brain spend. Only the two active coworkers switch chat lanes.
    if (brainKey === 'claude') setHubLane('CLAUDE');
    if (brainKey === 'codex') setHubLane('CODEX');
  }, []);

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

      <div className="flex h-9 shrink-0 items-center justify-end gap-4 px-4 pt-2 font-mono text-[9px] text-ink-low">
        <span>AGENTS <NumberTicker value={initialAgents.length} className="ml-1 text-primary" /></span>
        <span>TASKS <NumberTicker value={initialTasks.length} className="ml-1 text-agent-codex" /></span>
        <span>EVENTS <NumberTicker value={initialLogs.length} className="ml-1 text-agent-grok" /></span>
      </div>
      <div className="h-[351px] shrink-0 px-2 pt-2">
        <WidgetErrorBoundary name="Brain Hub">
          <SpatialWorkspace onBrainSelect={selectSpatialBrain} />
        </WidgetErrorBoundary>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 p-2 xl:grid-cols-12">
        <div className="min-h-[24rem] xl:col-span-8">
          <TiltedCard containerHeight="100%" imageHeight="100%" imageWidth="100%" scaleOnHover={1.01} rotateAmplitude={1.5} showMobileWarning={false} showTooltip={false}>
          <PanelChrome title={`MAIN BRAINS · ${hubLane}`} bodyClassName="p-0" className="h-full glass">
            <WidgetErrorBoundary name="Hub Chat">
              <AgentChat
                variant="full"
                historyScope="hub"
                title={hubLane === 'CODEX' ? 'Codex' : 'Claude'}
                lanes={['CLAUDE', 'CODEX']}
                defaultLane="CLAUDE"
                selectedLane={hubLane}
                onLaneChange={setHubLane}
                emptyText={
                  hubLane === 'CODEX'
                    ? 'Codex is the active brain — ask for implementation.'
                    : 'Claude is the active brain — ask for direction. Click the Codex planet to switch.'
                }
              />
            </WidgetErrorBoundary>
          </PanelChrome>
          </TiltedCard>
        </div>

        <div className="min-h-[24rem] xl:col-span-4">
          <TiltedCard containerHeight="100%" imageHeight="100%" imageWidth="100%" scaleOnHover={1.01} rotateAmplitude={1.5} showMobileWarning={false} showTooltip={false}>
          <PanelChrome title="HISTORY" bodyClassName="p-0" className="h-full glass">
            <WidgetErrorBoundary name="History">
              <ChatHistoryPanel mode="activity" maxItems={60} />
            </WidgetErrorBoundary>
          </PanelChrome>
          </TiltedCard>
        </div>
      </div>

      {/* Realtime degraded-state toast (overlay, non-shifting) */}
      <ConnectionBanner />
    </>
  );
}

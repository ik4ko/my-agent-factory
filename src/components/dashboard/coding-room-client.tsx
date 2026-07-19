'use client';

import { AgentChat } from './agent-chat';
import { TaskOutputFeed } from './task-output-feed';
import { TaskFeed } from './task-feed';
import { PanelChrome } from '@/components/deck';
import { WorkspaceGrid, type WorkspacePanelDef } from '@/components/deck/workspace-grid';
import { WidgetErrorBoundary } from './widget-error-boundary';

// Defaults mirror the previous fixed grid: chat on the left, review +
// tasks stacked on the right. h is in 40px grid rows.
const DEFAULT_LAYOUTS = {
  lg: [
    { i: 'chat', x: 0, y: 0, w: 5, h: 16, minW: 3, minH: 8 },
    { i: 'review', x: 5, y: 0, w: 7, h: 8, minW: 3, minH: 4 },
    { i: 'tasks', x: 5, y: 8, w: 7, h: 8, minW: 3, minH: 4 },
  ],
  md: [
    { i: 'chat', x: 0, y: 0, w: 8, h: 10 },
    { i: 'review', x: 0, y: 10, w: 8, h: 7 },
    { i: 'tasks', x: 0, y: 17, w: 8, h: 7 },
  ],
  sm: [
    { i: 'chat', x: 0, y: 0, w: 1, h: 10 },
    { i: 'review', x: 0, y: 10, w: 1, h: 7 },
    { i: 'tasks', x: 0, y: 17, w: 1, h: 7 },
  ],
};

export function CodingRoomClient() {
  const panels: WorkspacePanelDef[] = [
    {
      id: 'chat',
      label: 'coding chat',
      node: (
        <PanelChrome title="CODING CHAT" accent="agent" bodyClassName="p-0" className="h-full">
          <WidgetErrorBoundary name="Coding Chat">
            <AgentChat
              variant="full"
              historyScope="coding"
              title="Coding Room"
              lanes={['CODEX', 'CLAUDE']}
              defaultLane="CODEX"
              emptyText="Ask Codex to implement or review; switch to Claude for architecture and prioritization."
            />
          </WidgetErrorBoundary>
        </PanelChrome>
      ),
    },
    {
      id: 'review',
      label: 'review',
      node: (
        <PanelChrome
          title="REVIEW"
          headerRight={<span className="font-mono text-[8.5px] text-ink-low">latest Codex output</span>}
          bodyClassName="overflow-y-auto p-2.5"
          className="h-full"
        >
          <WidgetErrorBoundary name="Code Review">
            <TaskOutputFeed
              agentTypes={['coder', 'planner']}
              title=""
              accent="text-agent-codex"
              emptyText="No Codex output yet."
            />
          </WidgetErrorBoundary>
        </PanelChrome>
      ),
    },
    {
      id: 'tasks',
      label: 'coding tasks',
      node: (
        <PanelChrome title="WORKING / COMPLETE" bodyClassName="p-0" className="h-full">
          <WidgetErrorBoundary name="Coding Tasks">
            <TaskFeed scope="coding" />
          </WidgetErrorBoundary>
        </PanelChrome>
      ),
    },
  ];

  return (
    <div className="h-[calc(100vh-8.5rem)] overflow-y-auto p-2">
      <WorkspaceGrid room="coding" panels={panels} defaultLayouts={DEFAULT_LAYOUTS} />
    </div>
  );
}

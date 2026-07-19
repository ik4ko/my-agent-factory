'use client';

import { AgentChat } from './agent-chat';
import { ChatHistoryPanel } from './chat-history-panel';
import { LifeContextInspector } from './life-context-inspector';
import { MentorSignalsPanel } from './mentor-signals-panel';
import { PersonalTodo } from './personal-todo';
import { PanelChrome } from '@/components/deck';
import { WorkspaceGrid, type WorkspacePanelDef } from '@/components/deck/workspace-grid';
import { WidgetErrorBoundary } from './widget-error-boundary';

// Defaults mirror the previous layout: chat wide on the left; todo,
// inspector, signals, and history stacked on the right. h = 40px rows.
const DEFAULT_LAYOUTS = {
  lg: [
    { i: 'chat', x: 0, y: 0, w: 7, h: 16, minW: 4, minH: 8 },
    { i: 'todo', x: 7, y: 0, w: 5, h: 5, minW: 2, minH: 3 },
    { i: 'inspector', x: 7, y: 5, w: 5, h: 5, minW: 3, minH: 3 },
    { i: 'signals', x: 7, y: 10, w: 5, h: 3, minW: 2, minH: 2 },
    { i: 'history', x: 7, y: 13, w: 5, h: 3, minW: 2, minH: 2 },
  ],
  md: [
    { i: 'chat', x: 0, y: 0, w: 8, h: 10 },
    { i: 'todo', x: 0, y: 10, w: 4, h: 5 },
    { i: 'inspector', x: 4, y: 10, w: 4, h: 5 },
    { i: 'signals', x: 0, y: 15, w: 4, h: 4 },
    { i: 'history', x: 4, y: 15, w: 4, h: 4 },
  ],
  sm: [
    { i: 'chat', x: 0, y: 0, w: 1, h: 10 },
    { i: 'todo', x: 0, y: 10, w: 1, h: 5 },
    { i: 'inspector', x: 0, y: 15, w: 1, h: 6 },
    { i: 'signals', x: 0, y: 21, w: 1, h: 4 },
    { i: 'history', x: 0, y: 25, w: 1, h: 4 },
  ],
};

export function PersonalRoomClient() {
  const panels: WorkspacePanelDef[] = [
    {
      id: 'chat',
      label: 'personal chat',
      node: (
        <PanelChrome title="PERSONAL CHAT" bodyClassName="p-0" className="h-full">
          <WidgetErrorBoundary name="Personal Chat">
            <AgentChat
              variant="full"
              historyScope="personal"
              title="Personal Room"
              lanes={['MENTOR_BUSINESS', 'MENTOR_MONEY', 'MENTOR_LIFE', 'MENTOR_HEALTH', 'CLAUDE']}
              defaultLane="MENTOR_BUSINESS"
              emptyText="Choose a mentor and talk privately. Each mentor keeps its own isolated history; the CLAUDE lane uses this room's shared history."
            />
          </WidgetErrorBoundary>
        </PanelChrome>
      ),
    },
    {
      id: 'todo',
      label: 'to-do',
      node: (
        <PanelChrome title="TO-DO / COMPLETE" bodyClassName="overflow-y-auto p-2.5" className="h-full">
          <WidgetErrorBoundary name="To-do">
            <PersonalTodo />
          </WidgetErrorBoundary>
        </PanelChrome>
      ),
    },
    {
      id: 'inspector',
      label: 'life context inspector',
      node: (
        <PanelChrome title="WHAT MY MENTORS KNOW" bodyClassName="p-0" className="h-full">
          <WidgetErrorBoundary name="Life Context Inspector">
            <LifeContextInspector />
          </WidgetErrorBoundary>
        </PanelChrome>
      ),
    },
    {
      id: 'signals',
      label: 'mentor signals',
      node: (
        <PanelChrome title="MENTOR SIGNALS" bodyClassName="p-0" className="h-full">
          <WidgetErrorBoundary name="Mentor Signals">
            <MentorSignalsPanel />
          </WidgetErrorBoundary>
        </PanelChrome>
      ),
    },
    {
      id: 'history',
      label: 'personal history',
      node: (
        <PanelChrome title="PERSONAL HISTORY" bodyClassName="p-0" className="h-full">
          <WidgetErrorBoundary name="Personal History">
            <ChatHistoryPanel
              scopes={[
                { scope: 'personal', label: 'Personal' },
                { scope: 'mentor_business', label: 'Business' },
                { scope: 'mentor_money', label: 'Money' },
                { scope: 'mentor_life', label: 'Life' },
                { scope: 'mentor_health', label: 'Health' },
              ]}
              maxItems={20}
            />
          </WidgetErrorBoundary>
        </PanelChrome>
      ),
    },
  ];

  return (
    <div className="h-[calc(100vh-8.5rem)] overflow-y-auto p-2">
      <WorkspaceGrid room="personal" panels={panels} defaultLayouts={DEFAULT_LAYOUTS} />
    </div>
  );
}

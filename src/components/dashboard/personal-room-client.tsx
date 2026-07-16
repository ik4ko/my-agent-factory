'use client';

import { AgentChat } from './agent-chat';
import { ChatHistoryPanel } from './chat-history-panel';
import { PersonalTodo } from './personal-todo';
import { PanelChrome } from '@/components/deck';
import { WidgetErrorBoundary } from './widget-error-boundary';

export function PersonalRoomClient() {
  return (
    <div className="grid h-[calc(100vh-8.5rem)] min-h-[38rem] grid-cols-1 gap-2 p-2 xl:grid-cols-12">
      <div className="min-h-0 xl:col-span-7">
        <PanelChrome title="PERSONAL CHAT" bodyClassName="p-0" className="h-full">
          <WidgetErrorBoundary name="Personal Chat">
            <AgentChat
              variant="full"
              historyScope="personal"
              title="Personal Room"
              lanes={['BUSINESS', 'LIFE', 'FOCUS', 'CLAUDE']}
              defaultLane="BUSINESS"
              emptyText="Choose a mentor lane and talk privately. This room has its own saved history."
            />
          </WidgetErrorBoundary>
        </PanelChrome>
      </div>

      <div className="flex min-h-0 flex-col gap-2 xl:col-span-5">
        <div className="min-h-0 flex-1">
          <PanelChrome title="TO-DO / COMPLETE" bodyClassName="overflow-y-auto p-2.5" className="h-full">
            <WidgetErrorBoundary name="To-do">
              <PersonalTodo />
            </WidgetErrorBoundary>
          </PanelChrome>
        </div>

        <div className="min-h-0 flex-1">
          <PanelChrome title="PERSONAL HISTORY" bodyClassName="p-0" className="h-full">
            <WidgetErrorBoundary name="Personal History">
              <ChatHistoryPanel scopes={[{ scope: 'personal', label: 'Personal' }]} maxItems={20} />
            </WidgetErrorBoundary>
          </PanelChrome>
        </div>
      </div>
    </div>
  );
}

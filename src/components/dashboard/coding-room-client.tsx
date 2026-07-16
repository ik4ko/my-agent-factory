'use client';

import { AgentChat } from './agent-chat';
import { TaskOutputFeed } from './task-output-feed';
import { TaskFeed } from './task-feed';
import { PanelChrome } from '@/components/deck';
import { WidgetErrorBoundary } from './widget-error-boundary';

export function CodingRoomClient() {
  return (
    <div className="grid h-[calc(100vh-8.5rem)] min-h-[38rem] grid-cols-1 gap-2 p-2 xl:grid-cols-12">
      <div className="min-h-0 xl:col-span-5">
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
      </div>

      <div className="flex min-h-0 flex-col gap-2 xl:col-span-7">
        <div className="min-h-0 flex-1">
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
        </div>

        <div className="min-h-0 flex-1">
          <PanelChrome title="WORKING / COMPLETE" bodyClassName="p-0" className="h-full">
            <WidgetErrorBoundary name="Coding Tasks">
              <TaskFeed scope="coding" />
            </WidgetErrorBoundary>
          </PanelChrome>
        </div>
      </div>
    </div>
  );
}

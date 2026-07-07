'use client';

import { KnowledgeSourceBadge } from './knowledge-source-badge';
import { RoomComposer } from './room-composer';
import { TaskOutputFeed } from './task-output-feed';
import { AgentFleet } from './agent-fleet';
import { TaskFeed } from './task-feed';
import { LiveTerminal } from './live-terminal';
import { WidgetErrorBoundary } from './widget-error-boundary';

/**
 * Research Room — led by Hermes (Scout assists). The knowledge-source badge
 * is a persistent trust signal with the same priority as the trading
 * simulation banner: findings here come from trained knowledge (plus cached
 * news events when fresh), never live web browsing.
 */
export function ResearchRoomClient() {
  return (
    <div className="flex flex-col gap-3">
      <WidgetErrorBoundary name="Knowledge Source">
        <KnowledgeSourceBadge />
      </WidgetErrorBoundary>

      <WidgetErrorBoundary name="Composer">
        <RoomComposer
          agentType="generic"
          agentLabel="Hermes"
          placeholder="Set a research objective for Hermes… (trained knowledge + cached news, no live web)"
          accent="text-neon-purple"
        />
      </WidgetErrorBoundary>

      <div className="grid gap-3 lg:grid-cols-2">
        <WidgetErrorBoundary name="Findings">
          <TaskOutputFeed
            agentTypes={['researcher', 'browser', 'generic']}
            title="Findings — latest research output"
            accent="text-neon-purple"
            emptyText="No findings yet — dispatch a research objective above and Hermes/Scout results land here."
          />
        </WidgetErrorBoundary>

        <section className="min-w-0">
          <h2 className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
            Research activity
          </h2>
          <div className="h-[340px] rounded-md border border-border p-2.5">
            <WidgetErrorBoundary name="Research Terminal">
              <LiveTerminal scope="research" />
            </WidgetErrorBoundary>
          </div>
        </section>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="h-[320px] min-w-0 rounded-md border border-border p-2.5">
          <WidgetErrorBoundary name="Research Fleet">
            <AgentFleet scope="research" />
          </WidgetErrorBoundary>
        </div>
        <div className="h-[320px] min-w-0 rounded-md border border-border p-2.5">
          <WidgetErrorBoundary name="Research Tasks">
            <TaskFeed scope="research" />
          </WidgetErrorBoundary>
        </div>
      </div>
    </div>
  );
}

'use client';

import { RoomComposer } from './room-composer';
import { TaskOutputFeed } from './task-output-feed';
import { AgentFleet } from './agent-fleet';
import { TaskFeed } from './task-feed';
import { LiveTerminal } from './live-terminal';
import { WidgetErrorBoundary } from './widget-error-boundary';

/**
 * Coding Room — Codex's workspace. Objectives dispatched here are pinned to
 * the coder agent type; the review panel shows the workers' real persisted
 * output (with diff-line highlighting when output is diff-shaped), and the
 * coding-scoped terminal doubles as the sandboxed tool-runner stream.
 */
export function CodingRoomClient() {
  return (
    <div className="flex flex-col gap-3">
      <WidgetErrorBoundary name="Composer">
        <RoomComposer
          agentType="coder"
          agentLabel="Codex"
          placeholder="Spec a build task for Codex… (routed to a coder agent, runs sandboxed)"
          accent="text-neon-cyan"
        />
      </WidgetErrorBoundary>

      <div className="grid gap-3 lg:grid-cols-2">
        <WidgetErrorBoundary name="Code Review">
          <TaskOutputFeed
            agentTypes={['coder', 'planner']}
            title="Code review — latest Codex output"
            accent="text-neon-cyan"
            emptyText="No Codex output yet — dispatch a build task above and its generated code / review notes stream in here."
          />
        </WidgetErrorBoundary>

        <section className="min-w-0">
          <h2 className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
            Tool-runner output
          </h2>
          <div className="h-[340px] rounded-md border border-border p-2.5">
            <WidgetErrorBoundary name="Coding Terminal">
              <LiveTerminal scope="coding" />
            </WidgetErrorBoundary>
          </div>
        </section>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="h-[320px] min-w-0 rounded-md border border-border p-2.5">
          <WidgetErrorBoundary name="Coding Fleet">
            <AgentFleet scope="coding" />
          </WidgetErrorBoundary>
        </div>
        <div className="h-[320px] min-w-0 rounded-md border border-border p-2.5">
          <WidgetErrorBoundary name="Coding Tasks">
            <TaskFeed scope="coding" />
          </WidgetErrorBoundary>
        </div>
      </div>
    </div>
  );
}

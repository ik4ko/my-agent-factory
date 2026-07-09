'use client';

import { RoomComposer } from './room-composer';
import { TaskOutputFeed } from './task-output-feed';
import { AgentFleet } from './agent-fleet';
import { TaskFeed } from './task-feed';
import { LiveTerminal } from './live-terminal';
import { PanelChrome } from '@/components/deck';
import { WidgetErrorBoundary } from './widget-error-boundary';

/**
 * Coding Room — CODEX's workspace, in the Instrument Deck layout
 * (Coding Room.dc.html): SPEC → CODEX composer, the REVIEW panel (real
 * persisted worker output with diff-line highlighting), RUNS · CODEX, and a
 * bottom register with the SANDBOX RUNNER (the coding-scoped terminal IS the
 * sandboxed tool-runner stream) and the coding fleet.
 *
 * Deviations from the mockup, flagged deliberately: the static file-tree pane
 * and the jest/coverage sandbox-session tiles have no backing data source in
 * this app (no coverage or tree tables) — nothing is fabricated; the real
 * tool-runner stream carries that register instead.
 */
export function CodingRoomClient() {
  return (
    <div className="flex flex-col gap-2 p-2">
      <WidgetErrorBoundary name="Composer">
        <RoomComposer
          agentType="coder"
          agentLabel="CODEX"
          placeholder="Describe the change: goal, constraints, files in scope, acceptance criteria…"
          accent="text-agent-codex"
        />
      </WidgetErrorBoundary>

      {/* Row 1 — REVIEW (hero) + RUNS · CODEX */}
      <div className="grid grid-cols-1 gap-2 xl:grid-cols-12">
        <div className="min-h-[22rem] min-w-0 xl:col-span-8 xl:h-[26rem]">
          <PanelChrome
            title="REVIEW"
            headerRight={
              <span className="font-mono text-[8.5px] text-ink-low">latest CODEX output · diff-aware</span>
            }
            bodyClassName="p-2.5"
            className="h-full"
          >
            <WidgetErrorBoundary name="Code Review">
              <TaskOutputFeed
                agentTypes={['coder', 'planner']}
                title=""
                accent="text-agent-codex"
                emptyText="No CODEX output yet — queue a spec above; generated code / review notes stream in here."
              />
            </WidgetErrorBoundary>
          </PanelChrome>
        </div>

        <div className="min-h-[22rem] min-w-0 xl:col-span-4 xl:h-[26rem]">
          <PanelChrome title="RUNS · CODEX" accent="agent" bodyClassName="p-0" className="h-full">
            <WidgetErrorBoundary name="Coding Tasks">
              <TaskFeed scope="coding" />
            </WidgetErrorBoundary>
          </PanelChrome>
        </div>
      </div>

      {/* Row 2 — SANDBOX RUNNER (tool-runner stream) + FLEET */}
      <div className="grid grid-cols-1 gap-2 xl:grid-cols-12">
        <div className="h-[20rem] min-w-0 xl:col-span-8">
          <PanelChrome
            title="SANDBOX RUNNER"
            headerRight={
              <span className="rounded-[2px] border border-neon-green/40 px-[5px] font-mono text-[7.5px] font-bold tracking-[0.08em] text-neon-green">
                ISOLATED
              </span>
            }
            bodyClassName="p-0"
            className="h-full bg-surface-deep"
          >
            <WidgetErrorBoundary name="Coding Terminal">
              <LiveTerminal scope="coding" />
            </WidgetErrorBoundary>
          </PanelChrome>
        </div>

        <div className="h-[20rem] min-w-0 xl:col-span-4">
          <PanelChrome title="FLEET · CODING" bodyClassName="p-0" className="h-full">
            <WidgetErrorBoundary name="Coding Fleet">
              <AgentFleet scope="coding" />
            </WidgetErrorBoundary>
          </PanelChrome>
        </div>
      </div>
    </div>
  );
}

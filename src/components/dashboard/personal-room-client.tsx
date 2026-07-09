'use client';

import Link from 'next/link';
import { Repeat, Settings } from 'lucide-react';
import { AgentChat } from './agent-chat';
import { PersonalTodo } from './personal-todo';
import { TokenStream } from './token-stream';
import { OutboundFeed } from './outbound-feed';
import { MemoryViewer } from './memory-viewer';
import { PanelChrome } from '@/components/deck';
import { WidgetErrorBoundary } from './widget-error-boundary';

/**
 * Personal Room — Instrument Deck treatment (Personal Room.dc.html), tuned
 * deliberately CALMER and less dense than Trading/Coding: three instruments
 * up top (assistant, TODAY hero, comms), a quiet vault/spend register below.
 *
 * Deviations from the mockup, flagged deliberately:
 *  - No rose staged-actions gate here: the app has no personal approval-queue
 *    table/API (outbound_messages is a SENT log — the assistant lane sends
 *    directly). Fabricating an approvable queue would fake a safety surface;
 *    the comms panel is labeled honestly as a feed. This also keeps the rose
 *    hue exclusive to the Trading gate.
 *  - No personal fleet/terminal: RoomScope has no 'personal' scope, and the
 *    calmer register is the design intent anyway.
 */
export function PersonalRoomClient() {
  return (
    <div className="flex flex-col gap-2 p-2">
      {/* Row 1 — assistant · TODAY hero · comms */}
      <div className="grid grid-cols-1 gap-2 xl:grid-cols-12">
        <div className="h-[30rem] min-w-0 xl:col-span-5">
          <PanelChrome
            title="ASSISTANT → HERMES"
            headerRight={<span className="font-mono text-[8.5px] text-ink-low">private scope</span>}
            bodyClassName="p-0"
            className="h-full"
          >
            <WidgetErrorBoundary name="Chat">
              <AgentChat variant="full" />
            </WidgetErrorBoundary>
          </PanelChrome>
        </div>

        <div className="h-[30rem] min-w-0 xl:col-span-4">
          <PanelChrome
            title="TODAY"
            headerRight={
              <span className="font-mono text-[8.5px] tabular text-ink-low">
                {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()}
              </span>
            }
            bodyClassName="p-2.5"
            className="h-full"
          >
            <WidgetErrorBoundary name="To-do">
              <PersonalTodo />
            </WidgetErrorBoundary>
          </PanelChrome>
        </div>

        <div className="h-[30rem] min-w-0 xl:col-span-3">
          <PanelChrome
            title="OUTBOUND · COMMS"
            headerRight={
              <span className="rounded-[2px] border border-primary/40 px-[5px] font-mono text-[7.5px] font-bold text-primary-bright">
                SENT LOG
              </span>
            }
            bodyClassName="p-2"
            className="h-full"
          >
            <WidgetErrorBoundary name="Outbound">
              <OutboundFeed />
            </WidgetErrorBoundary>
          </PanelChrome>
        </div>
      </div>

      {/* Row 2 — quiet register: vault + spend + admin */}
      <div className="grid grid-cols-1 gap-2 xl:grid-cols-12">
        <div className="h-[17rem] min-w-0 xl:col-span-5">
          <PanelChrome
            title="VAULT"
            headerRight={
              <span className="rounded-[2px] border border-primary/40 px-[5px] font-mono text-[7.5px] font-bold text-primary-bright">
                PRIVATE
              </span>
            }
            bodyClassName="p-0"
            className="h-full"
          >
            <WidgetErrorBoundary name="Vault">
              <MemoryViewer />
            </WidgetErrorBoundary>
          </PanelChrome>
        </div>

        <div className="h-[17rem] min-w-0 xl:col-span-7">
          <PanelChrome title="SPEND · 24H" bodyClassName="p-3" className="h-full">
            <WidgetErrorBoundary name="Token Stream">
              <TokenStream />
            </WidgetErrorBoundary>
          </PanelChrome>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 px-1 pb-1">
        <Link
          href="/dashboard/settings"
          className="flex items-center gap-1.5 rounded-[4px] border border-border/70 bg-surface-1 px-3 py-1.5 font-mono text-[10px] text-ink-mid transition-colors hover:border-primary/40 hover:text-ink-hi"
        >
          <Settings className="size-3 text-primary" aria-hidden /> SETTINGS · MODEL MATRIX
        </Link>
        <Link
          href="/dashboard/loops"
          className="flex items-center gap-1.5 rounded-[4px] border border-border/70 bg-surface-1 px-3 py-1.5 font-mono text-[10px] text-ink-mid transition-colors hover:border-agent-codex/40 hover:text-ink-hi"
        >
          <Repeat className="size-3 text-agent-codex" aria-hidden /> LOOPS · AUTHORING
        </Link>
      </div>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { Mail, Repeat, Settings } from 'lucide-react';
import { AgentChat } from './agent-chat';
import { PersonalTodo } from './personal-todo';
import { TokenStream } from './token-stream';
import { WidgetErrorBoundary } from './widget-error-boundary';

/**
 * Personal Room — a dedicated, highly-visible chat window and a personal
 * to-do tracker are the primary surfaces; metrics and admin routes stay
 * available underneath. Client email is no longer a standalone form: it's
 * background-driven through the assistant in the chat panel below (the
 * CLAUDE·CEO lane already dispatches real sends — see agent-chat.tsx) — no
 * separate to/subject/body fields to fill out.
 */
export function PersonalRoomClient() {
  return (
    <div className="flex flex-col gap-4">
      <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="h-[480px] min-w-0 rounded-md surface-glass hairline">
          <WidgetErrorBoundary name="Chat">
            <AgentChat variant="full" />
          </WidgetErrorBoundary>
        </div>
        <div className="flex flex-col gap-3">
          <WidgetErrorBoundary name="To-do">
            <PersonalTodo />
          </WidgetErrorBoundary>
          <p className="flex items-start gap-1.5 rounded-md surface-glass hairline px-3 py-2 font-terminal text-[10px] leading-relaxed text-muted-foreground/60">
            <Mail className="mt-0.5 size-3 shrink-0 text-neon-orange" aria-hidden />
            Client email now goes through the assistant — tell it who to email and what to say in the chat panel; it composes and sends.
          </p>
        </div>
      </section>

      <section>
        <h2 className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Metrics management · 24h spend</h2>
        <div className="h-[240px] rounded-md surface-glass p-3">
          <WidgetErrorBoundary name="Token Stream">
            <TokenStream />
          </WidgetErrorBoundary>
        </div>
      </section>

      <section>
        <h2 className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Administrative control</h2>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/dashboard/settings"
            className="flex items-center gap-1.5 rounded-md surface-glass hairline px-3 py-1.5 font-terminal text-[10px] text-foreground/80 transition-colors hover:text-foreground"
          >
            <Settings className="size-3 text-neon-cyan" aria-hidden /> Settings · model matrix &amp; connections
          </Link>
          <Link
            href="/dashboard/loops"
            className="flex items-center gap-1.5 rounded-md surface-glass hairline px-3 py-1.5 font-terminal text-[10px] text-foreground/80 transition-colors hover:text-foreground"
          >
            <Repeat className="size-3 text-neon-purple" aria-hidden /> Loops · authoring &amp; triggers
          </Link>
        </div>
      </section>
    </div>
  );
}

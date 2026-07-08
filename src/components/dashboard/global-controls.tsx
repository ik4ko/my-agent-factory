'use client';

import { useState } from 'react';
import { MessageSquare, X } from 'lucide-react';
import { EmergencyStop } from './emergency-stop';
import { AgentChat } from './agent-chat';
import { cn } from '@/lib/utils';

/**
 * Persistent global controls, mounted once at the dashboard layout level so
 * they stay pinned across all four rooms:
 *  - E-STOP — reachable from every room (safety hard-constraint).
 *  - Ambient chat — a collapsible right-edge overlay. The AgentChat panel is
 *    ALWAYS mounted (translated off-screen when collapsed, never conditionally
 *    unmounted), so its transcript + input state survive room navigation and
 *    it never blocks underlying room components when closed.
 */
export function GlobalControls() {
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <>
      {/* top-right control cluster — above room chrome, on every room */}
      <div className="pointer-events-auto absolute right-3 top-2 z-50 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setChatOpen((o) => !o)}
          aria-label={chatOpen ? 'Collapse ambient chat' : 'Open ambient chat'}
          aria-expanded={chatOpen}
          title="Ambient chat — persistent across every room"
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2 py-1 font-terminal text-[10px] uppercase tracking-wider transition-colors surface-glass hairline',
            chatOpen ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <MessageSquare className="size-3" aria-hidden />
          <span className="hidden sm:inline">Chat</span>
        </button>
        <EmergencyStop />
      </div>

      {/* ambient chat panel — right-edge sidebar, always mounted */}
      <aside
        aria-hidden={!chatOpen}
        aria-label="Ambient chat"
        className={cn(
          'absolute right-0 top-11 bottom-0 z-40 flex w-[92vw] max-w-[380px] flex-col overflow-hidden surface-glass',
          'transition-transform duration-200 ease-out',
          chatOpen ? 'translate-x-0' : 'pointer-events-none translate-x-[105%]'
        )}
      >
        <div className="hairline-b flex h-9 shrink-0 items-center gap-2 px-3">
          <MessageSquare className="size-3 text-primary" aria-hidden />
          <span className="font-terminal text-[10px] uppercase tracking-widest text-muted-foreground">Ambient Chat</span>
          <button
            onClick={() => setChatOpen(false)}
            aria-label="Collapse ambient chat"
            className="ml-auto rounded p-0.5 text-muted-foreground/40 transition-colors hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden px-2 pb-2">
          <AgentChat variant="full" />
        </div>
      </aside>
    </>
  );
}

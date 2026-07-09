'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { EmergencyStop } from './emergency-stop';
import { AgentChat } from './agent-chat';
import { cn } from '@/lib/utils';

/**
 * Persistent global controls, mounted once at the dashboard layout level so
 * they stay pinned across all four rooms:
 *  - E-STOP — reachable from every room (safety hard-constraint).
 *  - Global Chat — the docked orchestrate overlay (Global Chat.dc.html /
 *    Coding Room.dc.html §Global Chat): a collapsed pill bottom-right that
 *    expands into the ORCHESTRATE panel. Scope-aware per room (derived from
 *    the pathname), and the AgentChat panel is ALWAYS mounted (hidden when
 *    collapsed, never conditionally unmounted) so its transcript + input
 *    state survive room navigation.
 */
function useRoomScope(): string {
  const pathname = usePathname() ?? '';
  if (pathname.includes('/rooms/trading') || pathname.includes('/dashboard/trading')) return 'TRADING';
  if (pathname.includes('/rooms/coding')) return 'CODING';
  if (pathname.includes('/rooms/personal') || pathname.includes('/dashboard/personal')) return 'PERSONAL';
  if (pathname.includes('/loops')) return 'LOOPS';
  if (pathname.includes('/settings')) return 'SETTINGS';
  return 'HUB';
}

export function GlobalControls() {
  const [chatOpen, setChatOpen] = useState(false);
  const scope = useRoomScope();

  return (
    <>
      {/* top-right: E-STOP stays reachable from every room */}
      <div className="pointer-events-auto absolute right-3 top-2 z-50 flex items-center gap-2">
        <EmergencyStop />
      </div>

      {/* ── COLLAPSED PILL — docked bottom-right ── */}
      <div
        className={cn(
          'absolute bottom-[18px] right-[18px] z-40 w-[min(452px,92vw)]',
          chatOpen && 'pointer-events-none opacity-0',
        )}
      >
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          aria-label="Expand global chat"
          aria-expanded={chatOpen}
          className="flex w-full items-center gap-[11px] rounded-lg border border-primary/25 border-l-2 border-l-primary bg-[rgba(11,18,32,0.92)] px-[14px] py-3 text-left shadow-[0_20px_50px_-20px_rgba(0,0,0,0.85)] backdrop-blur-[14px] transition-colors hover:border-primary/50"
        >
          <span className="font-mono text-[15px] font-bold leading-none text-primary" aria-hidden>
            &gt;
          </span>
          <span className="flex-1 truncate text-[12px] text-[#6b7c96]">Orchestrate across agents…</span>
          <span className="hidden shrink-0 rounded-[3px] border border-primary/35 bg-primary/[0.06] px-2 py-[3px] font-mono text-[8px] font-bold tracking-[0.1em] text-primary-bright sm:inline">
            SCOPE · {scope}
          </span>
          <ChevronUp className="size-[14px] shrink-0 text-ink-low" aria-hidden />
        </button>
      </div>

      {/* ── EXPANDED ORCHESTRATE PANEL — always mounted, hidden when collapsed ── */}
      <aside
        aria-hidden={!chatOpen}
        aria-label="Global chat — orchestrate"
        className={cn(
          'absolute bottom-[18px] right-[18px] z-40 flex w-[min(462px,94vw)] flex-col overflow-hidden rounded-[10px]',
          'h-[min(620px,80vh)] border border-primary/20 bg-gradient-to-b from-[rgba(12,20,34,0.96)] to-[rgba(8,13,22,0.98)]',
          'shadow-[0_40px_90px_-30px_rgba(0,0,0,0.9)] backdrop-blur-[16px]',
          'transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none',
          chatOpen ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0',
        )}
      >
        <div className="flex h-11 shrink-0 items-center gap-[9px] border-b border-border/50 px-[14px]">
          <span className="font-mono text-[14px] font-bold leading-none text-primary" aria-hidden>
            &gt;
          </span>
          <span className="font-mono text-[10px] tracking-[0.2em] text-ink-hi">ORCHESTRATE</span>
          <div className="ml-auto flex items-center gap-[6px]">
            <span className="rounded-[4px] border border-border/60 px-2 py-[3px] font-mono text-[8px] tracking-[0.08em] text-ink-mid">
              SCOPE · {scope}
            </span>
            <button
              onClick={() => setChatOpen(false)}
              aria-label="Collapse global chat"
              className="flex size-[26px] items-center justify-center rounded-[5px] border border-border/60 text-ink-mid transition-colors hover:border-primary/50 hover:text-primary-bright"
            >
              <ChevronDown className="size-[14px]" aria-hidden />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden px-2 pb-2">
          <AgentChat variant="full" />
        </div>
      </aside>
    </>
  );
}

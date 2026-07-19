'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity, Code2, Globe, Layers, RefreshCw, Search,
  Terminal, Zap, Keyboard, MapPin, LineChart, Siren, Sparkles, type LucideIcon,
} from 'lucide-react';
import {
  Command, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList, CommandSeparator, CommandShortcut,
} from '@/components/ui/command';
import { AGENTS_KEY } from '@/hooks/use-agents-query';
import { TASKS_KEY } from '@/hooks/use-tasks-query';
import { LOGS_KEY } from '@/hooks/use-logs-query';
import { QUOTES_KEY } from '@/hooks/use-quotes-query';
import { useControlStore } from '@/lib/control/control-store';
import { useMotionStore } from '@/lib/ui/motion-store';
import type { Agent, AgentType } from '@/lib/types/database.types';
import type { QuoteRow } from '@/lib/types/database.types';
import { cn } from '@/lib/utils';

/** Briefly outlines a `[data-screen-label]` panel — the ⌘K "jump" action. */
function flashPanel(label: string) {
  const el = document.querySelector<HTMLElement>(`[data-screen-label="${CSS.escape(label)}"]`);
  if (!el) return;
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  el.style.outline = '2px solid #a3b1f7';
  el.style.outlineOffset = '-2px';
  setTimeout(() => { el.style.outline = ''; }, 900);
}

const AGENT_ICONS: Record<AgentType, LucideIcon> = {
  generic: Activity, coder: Code2, researcher: Search,
  browser: Globe, planner: Layers,
};

const AGENT_COLORS: Record<AgentType, string> = {
  generic: 'text-neon-green', coder: 'text-neon-cyan',
  researcher: 'text-neon-purple', browser: 'text-neon-orange', planner: 'text-primary',
};

function inferAgentType(name: string): AgentType {
  const n = name.toLowerCase();
  if (n.includes('codex'))     return 'coder';
  if (n.includes('scout'))     return 'researcher';
  if (n.includes('phantom'))   return 'browser';
  if (n.includes('architect')) return 'planner';
  return 'generic';
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const qc = useQueryClient();
  const agents = qc.getQueryData<Agent[]>(AGENTS_KEY) ?? [];
  const quotes = qc.getQueryData<QuoteRow[]>(QUOTES_KEY) ?? [];
  const emergencyOpen = useControlStore((s) => s.openEmergency);
  const motionOn = useMotionStore((s) => s.motion);
  const toggleMotion = useMotionStore((s) => s.toggle);

  // Panels currently mounted in this room, discovered from the
  // `data-screen-label` PanelChrome stamps every panel with — so the PANEL
  // group always matches whatever room is on screen, no hardcoded list.
  const [panelLabels, setPanelLabels] = useState<string[]>([]);
  useEffect(() => {
    if (!open) return;
    const labels = Array.from(document.querySelectorAll<HTMLElement>('[data-screen-label]'))
      .map((el) => el.dataset.screenLabel)
      .filter((v): v is string => Boolean(v));
    setPanelLabels(Array.from(new Set(labels)));
  }, [open]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  const run = useCallback(
    (fn: () => void) => {
      fn();
      close();
    },
    [close]
  );

  const refreshAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: AGENTS_KEY });
    qc.invalidateQueries({ queryKey: TASKS_KEY });
    qc.invalidateQueries({ queryKey: LOGS_KEY });
  }, [qc]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={close}
          />

          {/* Panel */}
          <motion.div
            key="panel"
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -8 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="fixed left-1/2 top-[160px] z-50 w-full max-w-[480px] -translate-x-1/2"
          >
            <div className="overflow-hidden rounded-lg border border-primary/25 bg-card shadow-[0_40px_90px_-30px_rgba(0,0,0,0.9)]">
              <Command>
                <CommandInput placeholder="Type a command or search…" autoFocus />
                <CommandList>
                  <CommandEmpty>
                    <span className="font-terminal text-xs text-muted-foreground/50">
                      No results found.
                    </span>
                  </CommandEmpty>

                  {/* ── Agents ─────────────────────────────── */}
                  {agents.length > 0 && (
                    <CommandGroup heading="Fleet">
                      {agents.map((agent) => {
                        const agentType = inferAgentType(agent.name);
                        const Icon = AGENT_ICONS[agentType];
                        const color = AGENT_COLORS[agentType];
                        return (
                          <CommandItem
                            key={agent.id}
                            value={`agent-${agent.name}`}
                            onSelect={() => run(() => {})}
                          >
                            <Icon className={cn('size-3.5', color)} />
                            <span>{agent.name}</span>
                            <span className="text-xs text-muted-foreground/50">{agentType}</span>
                            <span
                              className={cn(
                                'ml-auto font-terminal text-[10px]',
                                agent.status === 'idle'    && 'text-neon-green',
                                agent.status === 'busy'    && 'text-neon-cyan',
                                agent.status === 'error'   && 'text-neon-red',
                                agent.status === 'offline' && 'text-muted-foreground/40'
                              )}
                            >
                              {agent.status}
                            </span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  )}

                  <CommandSeparator />

                  {/* ── Navigation ─────────────────────────── */}
                  <CommandGroup heading="Navigate">
                    <CommandItem value="go-dashboard" onSelect={() => run(() => router.push('/dashboard'))}>
                      <Zap className="text-primary" />
                      <span>Control Room</span>
                      <CommandShortcut>G D</CommandShortcut>
                    </CommandItem>
                    <CommandItem value="go-agents" onSelect={() => run(() => router.push('/dashboard/agents'))}>
                      <Activity className="text-neon-green" />
                      <span>Agents</span>
                    </CommandItem>
                    <CommandItem value="go-tasks" onSelect={() => run(() => router.push('/dashboard/tasks'))}>
                      <Layers className="text-neon-cyan" />
                      <span>Tasks</span>
                    </CommandItem>
                  </CommandGroup>

                  <CommandSeparator />

                  {/* ── Actions ────────────────────────────── */}
                  <CommandGroup heading="Actions">
                    <CommandItem value="action-estop" onSelect={() => run(emergencyOpen)}>
                      <Siren className="text-warning" />
                      <span className="text-warning">Trigger E-STOP</span>
                      <span className="ml-auto font-terminal text-[8px] uppercase tracking-[0.1em] text-muted-foreground/40">
                        safety
                      </span>
                    </CommandItem>
                    <CommandItem value={`action-motion-${motionOn ? 'disable' : 'enable'}`} onSelect={() => run(toggleMotion)}>
                      <Sparkles className="text-warning" />
                      <span className="text-warning">{motionOn ? 'Disable' : 'Enable'} motion</span>
                      <span className="ml-auto font-terminal text-[8px] uppercase tracking-[0.1em] text-muted-foreground/40">
                        demo
                      </span>
                    </CommandItem>
                    <CommandItem value="refresh-all" onSelect={() => run(refreshAll)}>
                      <RefreshCw className="text-muted-foreground" />
                      <span>Refresh all data</span>
                      <CommandShortcut>R</CommandShortcut>
                    </CommandItem>
                    <CommandItem value="open-terminal" onSelect={() => run(() => {})}>
                      <Terminal className="text-muted-foreground" />
                      <span>Focus log terminal</span>
                      <CommandShortcut>L</CommandShortcut>
                    </CommandItem>
                    <CommandItem value="shortcuts" onSelect={() => run(() => {})}>
                      <Keyboard className="text-muted-foreground" />
                      <span>Keyboard shortcuts</span>
                      <CommandShortcut>?</CommandShortcut>
                    </CommandItem>
                  </CommandGroup>

                  {/* ── Panels — discovered from [data-screen-label] ── */}
                  {panelLabels.length > 0 && (
                    <>
                      <CommandSeparator />
                      <CommandGroup heading="Panels">
                        {panelLabels.map((label) => (
                          <CommandItem key={label} value={`panel-${label}`} onSelect={() => run(() => flashPanel(label))}>
                            <MapPin className="text-ink-label" />
                            <span>{label}</span>
                            <span className="ml-auto font-terminal text-[8px] uppercase tracking-[0.1em] text-muted-foreground/40">
                              jump
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </>
                  )}

                  {/* ── Tickers — from the live watchlist cache ─── */}
                  {quotes.length > 0 && (
                    <>
                      <CommandSeparator />
                      <CommandGroup heading="Tickers">
                        {quotes.map((q) => (
                          <CommandItem key={q.symbol} value={`ticker-${q.symbol}`} onSelect={() => run(() => flashPanel('Watchlist'))}>
                            <LineChart className="text-ink-label" />
                            <span className="wt-hover font-bold">{q.symbol}</span>
                            <span className="ml-auto font-terminal text-[8px] uppercase tracking-[0.1em] text-muted-foreground/40">
                              watchlist
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </>
                  )}
                </CommandList>
              </Command>

              {/* Footer */}
              <div className="flex items-center gap-3 border-t border-border px-3 py-2">
                <span className="font-terminal text-[10px] text-muted-foreground/40">
                  ↑↓ navigate
                </span>
                <span className="font-terminal text-[10px] text-muted-foreground/40">
                  ↵ select
                </span>
                <span className="font-terminal text-[10px] text-muted-foreground/40">
                  esc close
                </span>
                <span className="ml-auto font-terminal text-[10px] text-neon-green/50">
                  HERMES READY
                </span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

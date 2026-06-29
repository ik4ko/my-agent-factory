'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity, Code2, Globe, Layers, RefreshCw, Search,
  Terminal, Zap, Keyboard,
} from 'lucide-react';
import {
  Command, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList, CommandSeparator, CommandShortcut,
} from '@/components/ui/command';
import { AGENTS_KEY } from '@/hooks/use-agents-query';
import { TASKS_KEY } from '@/hooks/use-tasks-query';
import { LOGS_KEY } from '@/hooks/use-logs-query';
import type { Agent } from '@/lib/types/database.types';
import { cn } from '@/lib/utils';

const AGENT_ICONS: Record<string, React.ElementType> = {
  generic: Activity, coder: Code2, researcher: Search,
  browser: Globe, planner: Layers,
};

const AGENT_COLORS: Record<string, string> = {
  generic: 'text-neon-green', coder: 'text-neon-cyan',
  researcher: 'text-neon-purple', browser: 'text-neon-orange', planner: 'text-primary',
};

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const qc = useQueryClient();
  const agents = qc.getQueryData<Agent[]>(AGENTS_KEY) ?? [];

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
            className="fixed left-1/2 top-[20%] z-50 w-full max-w-lg -translate-x-1/2"
          >
            <div className="overflow-hidden rounded-lg border border-border bg-popover shadow-[0_0_40px_hsl(var(--neon-green)/0.08)] card-neon">
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
                        const Icon = AGENT_ICONS[agent.type] ?? Activity;
                        const color = AGENT_COLORS[agent.type] ?? 'text-primary';
                        return (
                          <CommandItem
                            key={agent.id}
                            value={`agent-${agent.name}`}
                            onSelect={() => run(() => {})}
                          >
                            <Icon className={cn('size-3.5', color)} />
                            <span>{agent.name}</span>
                            <span className="text-xs text-muted-foreground/50">{agent.type}</span>
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

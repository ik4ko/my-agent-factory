'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { TerminalSquare, X, CornerDownLeft } from 'lucide-react';
import { useCommandStore } from '@/lib/cli/command-store';
import { useControlStore } from '@/lib/control/control-store';
import { COMMANDS, parseCommand, autocomplete, type CommandContext } from '@/lib/cli/commands';
import { cn } from '@/lib/utils';
import { ShimmerButton } from '@/components/ui/shimmer-button';

const OUTPUT_COLOR = {
  info: 'text-foreground/70',
  success: 'text-neon-green',
  error: 'text-neon-red',
  system: 'text-neon-cyan',
} as const;

export function CommandConsole() {
  const open = useCommandStore((s) => s.open);
  const setOpen = useCommandStore((s) => s.setOpen);
  const outputs = useCommandStore((s) => s.outputs);
  const history = useCommandStore((s) => s.history);
  const pushHistory = useCommandStore((s) => s.pushHistory);
  const print = useCommandStore((s) => s.print);
  const openEmergency = useControlStore((s) => s.openEmergency);
  const qc = useQueryClient();

  const [value, setValue] = useState('');
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const outRef = useRef<HTMLDivElement>(null);

  const ctx: CommandContext = useMemo(
    () => ({ queryClient: qc, print, requestEmergencyStop: openEmergency }),
    [qc, print, openEmergency]
  );

  // Inline ghost suggestion (first autocomplete match).
  const suggestion = useMemo(() => {
    if (!value.trim()) return '';
    const hit = autocomplete(value, qc)[0];
    return hit && hit.toLowerCase().startsWith(value.toLowerCase()) && hit.length > value.length ? hit : '';
  }, [value, qc]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight;
  }, [outputs.length]);

  if (!open) return null;

  const submit = () => {
    const raw = value.trim();
    if (!raw) return;
    pushHistory(raw);
    setHistIdx(null);
    print(`❯ ${raw}`, 'system');
    setValue('');

    const parsed = parseCommand(raw);
    if (!parsed) return;
    const cmd = COMMANDS[parsed.name];
    if (!cmd) {
      print(`Unknown command: ${parsed.name}. Type /help`, 'error');
      return;
    }
    void cmd.run(parsed.args, ctx);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); return; }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
    if ((e.key === 'Tab' || e.key === 'ArrowRight') && suggestion) {
      e.preventDefault();
      setValue(suggestion);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      const next = histIdx === null ? history.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(next);
      setValue(history[next]);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histIdx === null) return;
      const next = histIdx + 1;
      if (next >= history.length) { setHistIdx(null); setValue(''); }
      else { setHistIdx(next); setValue(history[next]); }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 pt-[12vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-xl border border-primary/30 bg-surface-1 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="flex items-center gap-2 text-primary">
            <TerminalSquare className="size-3.5" />
            <span className="font-terminal text-[10px] uppercase tracking-[0.2em]">Command Console</span>
          </div>
          <button onClick={() => setOpen(false)} className="text-muted-foreground/40 hover:text-muted-foreground">
            <X className="size-3.5" />
          </button>
        </div>

        {/* Output transcript */}
        <div ref={outRef} className="max-h-[40vh] min-h-[120px] overflow-y-auto px-3 py-2 font-terminal text-[11px] leading-relaxed">
          {outputs.length === 0 ? (
            <p className="text-muted-foreground/30">Type <span className="text-primary">/help</span> to list commands. ↑/↓ history · Tab autocomplete · Esc close.</p>
          ) : (
            outputs.map((line) => (
              <div key={line.id} className={cn('whitespace-pre-wrap break-words', OUTPUT_COLOR[line.level])}>
                {line.text}
              </div>
            ))
          )}
        </div>

        {/* Input with inline ghost autocomplete */}
        <div className="relative flex items-center gap-2 border-t border-border px-3 py-2.5">
          <span className="font-terminal text-primary">/</span>
          <div className="relative flex-1">
            {suggestion && (
              <div className="pointer-events-none absolute inset-0 font-terminal text-xs text-muted-foreground/25">
                {suggestion.replace(/^\//, '')}
              </div>
            )}
            <input
              ref={inputRef}
              value={value.replace(/^\//, '')}
              onChange={(e) => setValue('/' + e.target.value.replace(/^\//, ''))}
              onKeyDown={onKeyDown}
              spellCheck={false}
              autoComplete="off"
              suppressHydrationWarning={true}
              placeholder="spawn Atlas --role coder"
              className="relative w-full bg-transparent font-terminal text-xs text-foreground placeholder:text-muted-foreground/20 outline-none"
            />
          </div>
          <ShimmerButton onClick={submit} shimmerColor="#a3b1f7" background="rgba(163,177,247,.12)" borderRadius="4px" className="h-7 gap-1 px-2 font-terminal text-[10px] text-primary">
            <CornerDownLeft className="size-3" /> RUN
          </ShimmerButton>
        </div>
      </div>
    </div>
  );
}

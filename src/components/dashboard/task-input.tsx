'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Terminal, Loader2, CornerDownLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

type TraceKind = 'ok' | 'error';
interface Trace {
  kind: TraceKind;
  text: string;
  id: number;
}

// Terminal command bar → queues a pending task (lane router picks it up).
// Distinct from the Hermes intent bar: this bar does the raw insert flow.
export function TaskInput() {
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const [trace, setTrace] = useState<Trace | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!trace) return;
    const t = setTimeout(() => setTrace(null), 5000);
    return () => clearTimeout(t);
  }, [trace]);

  const submit = useCallback(
    async (raw: string) => {
      const prompt = raw.trim();
      if (!prompt || pending) return; // empty inputs handled gracefully
      setPending(true);
      try {
        const res = await fetch('/api/tasks/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt }),
        });
        const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
        if (!res.ok || !data.id) throw new Error(data.error ?? `failed (${res.status})`);
        setValue(''); // clear instantly on success
        setTrace({ kind: 'ok', text: `queued ${data.id.slice(0, 8)} — pending`, id: Date.now() });
      } catch (err) {
        setTrace({ kind: 'error', text: err instanceof Error ? err.message : 'queue failed', id: Date.now() });
      } finally {
        setPending(false);
        inputRef.current?.focus();
      }
    },
    [pending]
  );

  return (
    <div className="shrink-0 border-t border-border bg-surface-1/40 px-4 py-2 space-y-1">
      <div
        className={cn(
          'flex items-center gap-2 rounded-md border px-3 py-2 bg-surface-1 transition-colors duration-150',
          pending ? 'border-primary/50' : 'border-border hover:border-border/60 focus-within:border-primary/60'
        )}
      >
        {pending ? (
          <Loader2 className="size-3.5 text-primary animate-spin shrink-0" />
        ) : (
          <span className="font-terminal text-xs text-primary shrink-0 select-none">❯</span>
        )}
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit(value);
          }}
          disabled={pending}
          placeholder="Queue a task for the fleet…"
          autoComplete="off"
          spellCheck={false}
          className={cn(
            'flex-1 bg-transparent font-terminal text-xs text-foreground',
            'placeholder:text-muted-foreground/25 outline-none disabled:opacity-60'
          )}
        />
        <button
          onClick={() => void submit(value)}
          disabled={!value.trim() || pending}
          className={cn(
            'flex items-center gap-1 font-terminal text-[10px] transition-colors duration-100 select-none',
            value.trim() && !pending ? 'text-primary hover:text-primary/70' : 'text-muted-foreground/20 cursor-not-allowed'
          )}
        >
          <Terminal className="size-3" /> QUEUE <CornerDownLeft className="size-2.5" />
        </button>
      </div>

      <AnimatePresence>
        {trace && (
          <motion.p
            key={trace.id}
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.3 } }}
            transition={{ duration: 0.12 }}
            className={cn(
              'font-terminal text-[10px] px-1',
              trace.kind === 'ok' ? 'text-neon-green' : 'text-neon-red'
            )}
          >
            {trace.kind === 'ok' ? '✓ ' : '✗ '}
            {trace.text}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

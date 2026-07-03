'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type TraceKind = 'ok' | 'error';
interface Trace {
  kind: TraceKind;
  text: string;
  id: number;
}

// Single terminal command dock. Queues a pending task via the auth-gated
// /api/tasks/create route (tasks has RLS on with no policies → no browser
// anon insert); the lane router + triage pick it up from there.
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
      if (!prompt || pending) return; // empty input → no-op
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
    <div className="shrink-0 border-t border-border bg-[#0A0A0A] px-4 py-2.5 space-y-1">
      <div
        className={cn(
          'group flex items-center gap-2.5 rounded-md border border-l-2 border-border bg-[#0A0A0A]',
          'px-3 py-2.5 transition-colors duration-150',
          'focus-within:border-emerald-500/50 focus-within:border-l-emerald-500'
        )}
      >
        {/* prompt glyph */}
        {pending ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-emerald-500" />
        ) : (
          <span className="select-none font-terminal text-sm font-bold leading-none text-emerald-500">❯</span>
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
          suppressHydrationWarning={true}
          className={cn(
            'flex-1 bg-transparent font-terminal text-xs text-foreground',
            'placeholder:text-muted-foreground/25 outline-none disabled:opacity-60'
          )}
        />

        {/* right-boundary tracking anchor */}
        <button
          onClick={() => void submit(value)}
          disabled={!value.trim() || pending}
          className={cn(
            'shrink-0 select-none font-terminal text-[10px] tracking-[0.2em] transition-colors duration-100',
            value.trim() && !pending
              ? 'text-emerald-500/80 hover:text-emerald-400'
              : 'text-muted-foreground/25 cursor-not-allowed'
          )}
        >
          [ ENTER TO QUEUE ]
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
              'px-1 font-terminal text-[10px]',
              trace.kind === 'ok' ? 'text-emerald-500' : 'text-neon-red'
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

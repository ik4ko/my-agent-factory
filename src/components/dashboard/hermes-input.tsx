'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Terminal, Loader2, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HermesResult } from '@/lib/hermes/types';

const STATUS_COLOR: Record<HermesResult['status'], string> = {
  dispatched: 'text-neon-green',
  no_agents:  'text-neon-orange',
  error:      'text-neon-red',
};

export function HermesInput() {
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<HermesResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-clear result after 6 s
  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => setResult(null), 6000);
    return () => clearTimeout(t);
  }, [result]);

  async function submit() {
    const cmd = value.trim();
    if (!cmd || pending) return;
    setPending(true);
    setValue('');
    try {
      const res = await fetch('/api/hermes/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd }),
      });
      const data = (await res.json()) as HermesResult;
      setResult(data);
    } catch {
      setResult({
        requestId: '',
        status: 'error',
        intent: { agentType: 'generic', priority: 5, description: cmd, confidence: 'llm' },
        message: 'Network error — Hermes unreachable.',
      });
    } finally {
      setPending(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="shrink-0 border-t border-border px-4 py-2 space-y-1">
      {/* Input bar */}
      <div
        className={cn(
          'flex items-center gap-2 rounded-md border px-3 py-2',
          'bg-surface-1 transition-colors duration-150',
          pending
            ? 'border-primary/50'
            : 'border-border hover:border-border/60 focus-within:border-primary/60'
        )}
      >
        {pending ? (
          <Loader2 className="size-3.5 text-primary animate-spin shrink-0" />
        ) : (
          <Terminal className="size-3.5 text-muted-foreground/30 shrink-0" />
        )}

        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          disabled={pending}
          placeholder="Issue command to Hermes…"
          autoComplete="off"
          spellCheck={false}
          className={cn(
            'flex-1 bg-transparent font-terminal text-xs text-foreground',
            'placeholder:text-muted-foreground/20 outline-none',
            'disabled:opacity-40'
          )}
        />

        <button
          onClick={() => void submit()}
          disabled={!value.trim() || pending}
          className={cn(
            'flex items-center gap-0.5 font-terminal text-[10px] transition-colors duration-100 select-none',
            value.trim() && !pending
              ? 'text-primary hover:text-primary/70'
              : 'text-muted-foreground/20 cursor-not-allowed'
          )}
        >
          <ChevronRight className="size-3" />
          SEND
        </button>
      </div>

      {/* Status / result line */}
      <AnimatePresence>
        {result && (
          <motion.p
            key={result.requestId || result.message}
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.3 } }}
            transition={{ duration: 0.12 }}
            className={cn('font-terminal text-[10px] px-1', STATUS_COLOR[result.status])}
          >
            {result.status === 'dispatched' && '✓ '}
            {result.status === 'error' && '✗ '}
            {result.status === 'no_agents' && '⚠ '}
            {result.message}
            {result.intent && (
              <span className="ml-2 opacity-40">
                [{result.intent.agentType} · p{result.intent.priority} · {result.intent.confidence}]
              </span>
            )}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

'use client';

import { useRef, useState } from 'react';
import { Loader2, SendHorizonal } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import type { AgentType } from '@/lib/types/database.types';

interface DispatchResponse {
  status?: string;
  taskId?: string;
  agentName?: string;
  message?: string;
  error?: string;
}

/**
 * Room-scoped task composer. Unlike the Control Room dock (which lets the
 * intent parser route), this pins dispatch to the room's agent type via the
 * command API's `target.agentType` — a Coding Room objective always lands on
 * a coder, a Research Room objective on the research lead.
 */
export function RoomComposer({
  agentType,
  agentLabel,
  placeholder,
  accent,
}: {
  agentType: AgentType;
  agentLabel: string;
  placeholder: string;
  accent: string;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const [trace, setTrace] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const submit = async () => {
    const objective = value.trim();
    if (!objective || pending) return;
    setPending(true);
    setTrace(null);
    try {
      const res = await fetch('/api/hermes/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: objective,
          issuedAt: new Date().toISOString(),
          target: { status: 'idle', agentType },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as DispatchResponse;
      if (!res.ok) throw new Error(data.error ?? `dispatch failed (${res.status})`);
      if (data.status !== 'dispatched' || !data.taskId) {
        throw new Error(data.message ?? 'dispatch failed');
      }
      setValue('');
      setTrace({ kind: 'ok', text: `dispatched to ${data.agentName ?? agentLabel} — task ${data.taskId.slice(0, 8)}` });
      await qc.invalidateQueries();
    } catch (err) {
      setTrace({ kind: 'error', text: err instanceof Error ? err.message : 'dispatch failed' });
    } finally {
      setPending(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="space-y-1">
      {/* Instrument Deck spec-composer treatment (Coding Room.dc.html §TASK
          SPEC → CODEX): mono input in a deep well, agent-accent frame, QUEUE
          SPEC action. Dispatch logic unchanged. */}
      <div className="flex items-center gap-2 rounded-[6px] border border-agent-codex/25 bg-gradient-to-b from-[#14112a] to-background px-3 py-2">
        <span className={cn('shrink-0 font-mono text-[9.5px] font-bold uppercase tracking-[0.2em]', accent)}>
          ⌐ SPEC → {agentLabel}
        </span>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
          disabled={pending}
          placeholder={placeholder}
          aria-label={`Objective for ${agentLabel}`}
          autoComplete="off"
          spellCheck={false}
          className="flex-1 rounded-[5px] border border-border/40 bg-surface-deep/70 px-3 py-1.5 font-mono text-[11px] text-ink-hi outline-none placeholder:text-ink-low/60 focus:border-agent-codex/50 disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!value.trim() || pending}
          aria-label={`Dispatch objective to ${agentLabel}`}
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded border px-3 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] transition-colors',
            value.trim() && !pending
              ? 'border-agent-codex/50 bg-agent-codex/[0.12] text-[#c4b5fd] hover:bg-agent-codex/[0.22]'
              : 'cursor-not-allowed border-ink-low/20 text-ink-low/60',
          )}
        >
          {pending ? <Loader2 className="size-3 animate-spin" /> : <SendHorizonal className="size-3" />}
          QUEUE SPEC
        </button>
      </div>
      {trace && (
        <p className={cn('px-1 font-mono text-[10px]', trace.kind === 'ok' ? 'text-neon-green' : 'text-destructive')} role="status">
          {trace.kind === 'ok' ? 'OK ' : ''}{trace.text}
        </p>
      )}
    </div>
  );
}

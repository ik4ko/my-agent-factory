'use client';

import { useRef, useState } from 'react';
import { GitCompareArrows, Loader2, SendHorizonal } from 'lucide-react';
import { dispatchAgent } from '@/app/actions/agent-dispatcher';
import { BRAIN_IDS, BRAIN_MATRIX, type BrainId } from '@/lib/agents/brain-matrix';
import { shortModel } from '@/lib/telemetry/pricing';
import { pushSystemFeed } from '@/lib/fx/system-feed';
import { cn } from '@/lib/utils';

interface LaneState {
  status: 'idle' | 'running' | 'done' | 'error';
  content: string;
  model?: string;
  latencyMs?: number;
}

const EMPTY: LaneState = { status: 'idle', content: '' };

/**
 * Consensus & Debate — dispatches ONE strategy prompt to two sovereign lanes
 * simultaneously and streams both replies into a side-by-side canvas, so
 * divergent agent logic (e.g. HERMES orchestration vs GROK contrarian market
 * read) can be reviewed against each other. Both calls go through the same
 * verified dispatchAgent server action and fire in parallel.
 */
export function ConsensusView() {
  const [left, setLeft] = useState<BrainId>('HERMES');
  const [right, setRight] = useState<BrainId>('GROK');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [states, setStates] = useState<Record<'left' | 'right', LaneState>>({ left: EMPTY, right: EMPTY });
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const run = async () => {
    const prompt = value.trim();
    if (!prompt || busy) return;
    setBusy(true);
    setStates({ left: { status: 'running', content: '' }, right: { status: 'running', content: '' } });
    pushSystemFeed('STRATEGY', `Consensus debate — ${left} vs ${right}: "${prompt.slice(0, 48)}${prompt.length > 48 ? '…' : ''}"`);

    const fire = async (lane: BrainId, side: 'left' | 'right') => {
      const t0 = performance.now();
      try {
        const r = await dispatchAgent({ agentId: lane, prompt });
        setStates((s) => ({
          ...s,
          [side]: r.error
            ? { status: 'error', content: r.error, model: r.modelUsed }
            : { status: 'done', content: r.content, model: r.modelUsed, latencyMs: Math.round(performance.now() - t0) },
        }));
      } catch (err) {
        setStates((s) => ({ ...s, [side]: { status: 'error', content: err instanceof Error ? err.message : 'dispatch failed' } }));
      }
    };

    // parallel — both lanes stream into the split canvas at once
    await Promise.all([fire(left, 'left'), fire(right, 'right')]);
    setBusy(false);
    inputRef.current?.focus();
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-1.5">
        <GitCompareArrows className="size-3.5 text-primary" aria-hidden />
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Consensus &amp; Debate</span>
      </div>

      {/* lane pickers + prompt */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <LanePicker value={left} onChange={setLeft} label="Lane A" exclude={right} />
        <span className="font-terminal text-[10px] text-muted-foreground/40">vs</span>
        <LanePicker value={right} onChange={setRight} label="Lane B" exclude={left} />
      </div>
      <div className="flex shrink-0 items-end gap-2 rounded-md border border-l-2 border-border bg-background px-2.5 py-1.5 focus-within:border-emerald-500/50 focus-within:border-l-emerald-500">
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void run();
            }
          }}
          rows={1}
          placeholder="Pose a strategy question to both lanes…"
          aria-label="Consensus prompt"
          spellCheck={false}
          className="max-h-24 flex-1 resize-none bg-transparent font-terminal text-xs text-foreground placeholder:text-muted-foreground/25 outline-none"
        />
        <button
          onClick={() => void run()}
          disabled={!value.trim() || busy}
          aria-label="Dispatch to both lanes"
          className={cn('shrink-0 rounded transition-colors', value.trim() && !busy ? 'text-emerald-500 hover:text-emerald-400' : 'cursor-not-allowed text-muted-foreground/25')}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <SendHorizonal className="size-3.5" aria-hidden />}
        </button>
      </div>

      {/* dual-pane canvas */}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-2">
        <LanePane title={left} state={states.left} />
        <LanePane title={right} state={states.right} />
      </div>
    </div>
  );
}

function LanePicker({ value, onChange, label, exclude }: { value: BrainId; onChange: (v: BrainId) => void; label: string; exclude: BrainId }) {
  return (
    <label className="flex items-center gap-1 font-terminal text-[10px] text-muted-foreground/50">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as BrainId)}
        aria-label={`${label} model`}
        className="rounded border border-border bg-surface-1 px-1.5 py-0.5 text-foreground outline-none focus:border-primary/40"
      >
        {BRAIN_IDS.filter((id) => id !== exclude).map((id) => (
          <option key={id} value={id}>
            {id} · {BRAIN_MATRIX[id].role}
          </option>
        ))}
      </select>
    </label>
  );
}

function LanePane({ title, state }: { title: BrainId; state: LaneState }) {
  return (
    <div className="flex min-h-0 flex-col rounded-md border border-border bg-surface-1/40">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border/60 px-2 py-1 font-terminal text-[10px]">
        <span className="font-bold text-foreground/85">{title}</span>
        <span className="text-muted-foreground/40">{shortModel(BRAIN_MATRIX[title].model)}</span>
        <span className="ml-auto">
          {state.status === 'running' && <Loader2 className="size-3 animate-spin text-primary" aria-hidden />}
          {state.status === 'done' && <span className="text-neon-green">{state.latencyMs}ms</span>}
          {state.status === 'error' && <span className="text-neon-red">error</span>}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {state.status === 'idle' ? (
          <p className="font-terminal text-[10px] text-muted-foreground/40">Awaiting a prompt.</p>
        ) : state.status === 'running' ? (
          <p className="font-terminal text-[10px] text-muted-foreground/50">thinking…</p>
        ) : (
          <p className={cn('whitespace-pre-wrap break-words text-[11px] leading-relaxed', state.status === 'error' ? 'text-neon-red/90' : 'text-foreground/85')}>
            {state.content}
          </p>
        )}
      </div>
    </div>
  );
}

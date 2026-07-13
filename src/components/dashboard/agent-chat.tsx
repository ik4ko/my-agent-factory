'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, Send, User, Volume2, VolumeX } from 'lucide-react';
import { dispatchAgent, type MaterializedArtifact } from '@/app/actions/agent-dispatcher';
import { BRAIN_IDS, BRAIN_MATRIX, type BrainId } from '@/lib/agents/brain-matrix';
import { classifyIntent } from '@/lib/agents/intent-router';
import { useConverse, speakBrowser } from '@/hooks/use-converse';
import { shortModel } from '@/lib/telemetry/pricing';
import { pushSystemFeed } from '@/lib/fx/system-feed';
import { cn } from '@/lib/utils';

// 'CEO' is the /api/converse delegation loop (visible as "CLAUDE · CEO").
// Its internal id was renamed from 'CLAUDE' → 'CEO' so the matrix can own a
// real 'CLAUDE' lane via BrainId without an id collision.
type Lane = 'CEO' | 'AUTO' | BrainId;

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  /** which brain answered (assistant turns) */
  agentId?: string;
  model?: string;
  error?: boolean;
  /** live-table rows this reply produced (Tasks panel / Staged Orders) */
  materialized?: MaterializedArtifact[];
  /** still-being-spoken STT partial (see useConverse.setInterim) — not yet a
   *  submitted message, rendered with a distinct "speaking…" treatment. */
  interim?: boolean;
}

/** AUTO lane routing — delegates to the shared central classifier so the
 *  Orchestrate panel and the global command dock resolve intent identically. */
export function routeIntent(prompt: string): BrainId {
  return classifyIntent(prompt).lane;
}

const LANE_LABEL = (lane: Lane): string =>
  lane === 'CEO' ? 'CLAUDE · CEO' : lane === 'AUTO' ? 'AUTO · intent-routed' : `${lane} · ${BRAIN_MATRIX[lane].role}`;

/**
 * Unified orchestration chat — THE prompt surface of the command horizon.
 * One transcript pipeline, two execution lanes:
 *  - CLAUDE (CEO): the existing /api/converse loop, kept because it executes
 *    real delegations (email sends, fleet actions) that raw completions
 *    can't.
 *  - AUTO + 9 matrix agents: the dispatchAgent server action against the
 *    OpenRouter brain matrix, with per-reply routing shown on the bubble.
 * Renders as a bounded panel widget in the workspace deck and inside the
 * global ambient-chat overlay.
 */
export function AgentChat({ variant = 'panel' }: { variant?: 'panel' | 'full' }) {
  const converse = useConverse();
  const [lane, setLane] = useState<Lane>('AUTO');
  const [matrixTurns, setMatrixTurns] = useState<ChatTurn[]>([]);
  const [matrixBusy, setMatrixBusy] = useState(false);
  const [value, setValue] = useState('');
  const [speakOn, setSpeakOn] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isCeo = lane === 'CEO';
  const busy = isCeo ? converse.busy : matrixBusy;
  const turns: ChatTurn[] = isCeo
    ? converse.history.map((t) => (t.role === 'assistant' ? { ...t, agentId: 'CEO' } : t))
    : matrixTurns;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns.length, busy]);

  const submit = async () => {
    const prompt = value.trim();
    if (!prompt || busy) return;
    setValue('');

    if (isCeo) {
      await converse.send(prompt, { speak: speakOn });
      inputRef.current?.focus();
      return;
    }

    const agentId = lane === 'AUTO' ? routeIntent(prompt) : lane;
    setMatrixBusy(true);
    setMatrixTurns((t) => [...t, { role: 'user', content: prompt }]);
    pushSystemFeed('DISPATCH', `[${agentId}] dispatch → "${prompt.slice(0, 48)}${prompt.length > 48 ? '…' : ''}"`);
    try {
      const history = matrixTurns
        .filter((t) => !t.error)
        .slice(-12)
        .map(({ role, content }) => ({ role, content }));
      const result = await dispatchAgent({ agentId, prompt, history });
      const content = result.error ?? result.content;
      setMatrixTurns((t) => [
        ...t,
        {
          role: 'assistant',
          content,
          agentId: result.agentId,
          model: result.modelUsed,
          error: Boolean(result.error),
          materialized: result.materialized,
        },
      ]);
      if (result.materialized?.length) {
        pushSystemFeed(
          'DISPATCH',
          `[${agentId}] → ${result.materialized.map((m) => m.label).join(', ')}`,
        );
      }
      if (speakOn && !result.error) speakBrowser(result.content);
    } catch (err) {
      setMatrixTurns((t) => [
        ...t,
        { role: 'assistant', content: err instanceof Error ? err.message : 'dispatch failed', agentId, error: true },
      ]);
    } finally {
      setMatrixBusy(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* header: lane selector + TTS */}
      <div
        className={cn(
          'flex shrink-0 items-center gap-2 border-b border-border',
          variant === 'full' ? 'h-11 px-4' : 'pb-1.5'
        )}
      >
        <Bot className="size-3.5 shrink-0 text-primary" aria-hidden />
        {variant === 'full' ? (
          <span className="font-display text-sm font-semibold tracking-wide text-foreground/90">Orchestrate</span>
        ) : (
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Orchestrate</span>
        )}
        <select
          value={lane}
          onChange={(e) => setLane(e.target.value as Lane)}
          aria-label="Execution lane"
          title="AUTO routes each prompt to the right brain by intent; CLAUDE·CEO keeps the delegation loop (email, fleet actions); or pin any of the 9 matrix agents."
          className="ml-1 min-w-0 max-w-[220px] rounded border border-border bg-surface-1 px-1.5 py-0.5 font-terminal text-[10px] text-foreground outline-none focus:border-primary/40"
        >
          <option value="AUTO">{LANE_LABEL('AUTO')}</option>
          <option value="CEO">{LANE_LABEL('CEO')}</option>
          {BRAIN_IDS.map((id) => (
            <option key={id} value={id}>
              {LANE_LABEL(id)}
            </option>
          ))}
        </select>
        <button
          onClick={() => setSpeakOn((s) => !s)}
          aria-pressed={speakOn}
          title={speakOn ? 'Replies are spoken aloud' : 'Replies are text-only'}
          className={cn(
            'ml-auto flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 font-terminal text-[9px] transition-colors',
            speakOn ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'
          )}
        >
          {speakOn ? <Volume2 className="size-2.5" aria-hidden /> : <VolumeX className="size-2.5" aria-hidden />}
          {speakOn ? 'SPEAK' : 'TEXT'}
        </button>
      </div>

      {/* transcript */}
      <div ref={scrollRef} className={cn('min-h-0 flex-1 space-y-2.5 overflow-y-auto py-2.5', variant === 'full' && 'px-4')}>
        {turns.length === 0 && (
          <div className="mt-6 px-2 text-center font-terminal text-[10px] leading-relaxed text-muted-foreground/50">
            {isCeo ? (
              <>Talk to Claude, the CEO brain — it can delegate real actions (email, fleet dispatch).</>
            ) : (
              <>
                One prompt, nine brains. AUTO picks the lane by intent — try{' '}
                <span className="text-foreground/70">&quot;patch the risk gate tests&quot;</span> (→ CODEX) or{' '}
                <span className="text-foreground/70">&quot;stress-test my SPY thesis&quot;</span> (→ GROK).
              </>
            )}
          </div>
        )}
        {turns.map((turn, i) => {
          const isUser = turn.role === 'user';
          return (
            <div key={i} className={cn('flex gap-2', isUser ? 'justify-end pr-0.5' : 'justify-start pl-0.5')}>
              {!isUser && (
                <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10">
                  <Bot className="size-2.5 text-primary" aria-hidden />
                </div>
              )}
              <div
                className={cn(
                  'max-w-[80%] rounded-lg px-2.5 py-1.5 text-xs leading-relaxed',
                  turn.interim
                    ? 'border border-dashed border-neon-cyan/40 bg-neon-cyan/[0.05] text-foreground/70'
                    : isUser
                      ? 'bg-surface-3 text-foreground'
                      : turn.error
                        ? 'border border-neon-red/30 bg-neon-red/[0.05] text-neon-red/90'
                        : 'border border-border bg-surface-1 text-foreground/90'
                )}
              >
                {!isUser && turn.agentId && (
                  <p className="mb-0.5 font-terminal text-[9px] uppercase tracking-wider text-muted-foreground/50">
                    {turn.agentId}
                    {turn.model ? ` · ${shortModel(turn.model)}` : ''}
                  </p>
                )}
                {turn.interim && (
                  <p className="mb-0.5 flex items-center gap-1 font-terminal text-[9px] uppercase tracking-wider text-neon-cyan/70">
                    <span className="size-1 animate-pulse rounded-full bg-neon-cyan" aria-hidden /> speaking…
                  </p>
                )}
                <span className="whitespace-pre-wrap break-words">{turn.content}</span>
                {turn.materialized && turn.materialized.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {turn.materialized.map((m) => (
                      <span
                        key={m.id}
                        className={cn(
                          'rounded border px-1.5 py-px font-terminal text-[9px] tracking-wide',
                          m.type === 'staged_order'
                            ? 'border-neon-green/40 text-neon-green/80'
                            : 'border-primary/40 text-primary/80'
                        )}
                      >
                        {m.type === 'staged_order' ? '◆ ' : '▸ '}
                        {m.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {isUser && (
                <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2">
                  <User className="size-2.5 text-muted-foreground" aria-hidden />
                </div>
              )}
            </div>
          );
        })}
        {busy && (
          <div className="flex items-center gap-2 font-terminal text-[10px] text-muted-foreground/60">
            <span className="size-1.5 animate-pulse rounded-full bg-primary" aria-hidden /> thinking…
          </div>
        )}
      </div>

      {/* input */}
      <div className={cn('shrink-0 border-t border-border pt-2', variant === 'full' && 'px-4 pb-3')}>
        <div className="flex items-end gap-2 rounded-md border border-l-2 border-border bg-background px-2.5 py-1.5 focus-within:border-emerald-500/50 focus-within:border-l-emerald-500">
          <textarea
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            rows={1}
            placeholder={isCeo ? 'Message Claude… (Enter to send)' : 'Command the matrix… (Enter to send)'}
            autoComplete="off"
            spellCheck={false}
            suppressHydrationWarning
            aria-label="Orchestration prompt"
            className="max-h-28 flex-1 resize-none bg-transparent font-terminal text-xs text-foreground placeholder:text-muted-foreground/25 outline-none"
          />
          <button
            onClick={() => void submit()}
            disabled={!value.trim() || busy}
            aria-label="Send prompt"
            className={cn(
              'flex shrink-0 items-center rounded transition-colors',
              value.trim() && !busy ? 'text-emerald-500 hover:text-emerald-400' : 'cursor-not-allowed text-muted-foreground/25'
            )}
          >
            <Send className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Loader2, Mic, MicOff, Send, User, Volume2, VolumeX } from 'lucide-react';
import { dispatchAgent, type MaterializedArtifact } from '@/app/actions/agent-dispatcher';
import type { ActiveBrainId } from '@/lib/agents/brain-matrix';
import { useCoreFxStore } from '@/lib/fx/core-store';
import { CHAT_HISTORY_UPDATED_EVENT } from '@/lib/chat/events';
import { speakBrowser } from '@/hooks/use-browser-speech';
import { useSpeechRecognition } from '@/hooks/use-speech-recognition';
import { shortModel } from '@/lib/telemetry/pricing';
import type { ChatHistoryScope } from '@/lib/chat/history';
import { cn } from '@/lib/utils';

type ClaudePersona = 'architect' | 'trading' | 'coding' | 'business_mentor' | 'life_mentor' | 'focus_mentor';
export type AgentChatLane = 'CLAUDE' | 'CODEX' | 'TRADING' | 'BUSINESS' | 'LIFE' | 'FOCUS';

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  agentId?: string;
  model?: string;
  error?: boolean;
  materialized?: MaterializedArtifact[];
  createdAt?: string;
}

interface LaneConfig {
  label: string;
  description: string;
  mode: 'claude' | 'codex';
  persona?: ClaudePersona;
  agentId?: ActiveBrainId;
}

const LANE_CONFIG: Record<AgentChatLane, LaneConfig> = {
  CLAUDE: {
    label: 'CLAUDE · architect',
    description: 'Main reasoning architect; delegates only when useful.',
    mode: 'claude',
    persona: 'architect',
  },
  CODEX: {
    label: 'CODEX · engineer',
    description: 'Implementation, code review, and technical execution.',
    mode: 'codex',
    agentId: 'CODEX',
  },
  TRADING: {
    label: 'CLAUDE · trading',
    description: 'Trading analysis only; staged/dry-run language stays explicit.',
    mode: 'claude',
    persona: 'trading',
  },
  BUSINESS: {
    label: 'Business mentor',
    description: 'Strategy, customers, leverage, and money decisions.',
    mode: 'claude',
    persona: 'business_mentor',
  },
  LIFE: {
    label: 'Life mentor',
    description: 'Habits, judgment, relationships, and emotional clarity.',
    mode: 'claude',
    persona: 'life_mentor',
  },
  FOCUS: {
    label: 'Focus mentor',
    description: 'Calm prioritization and next actions.',
    mode: 'claude',
    persona: 'focus_mentor',
  },
};

async function readHistory(scope: ChatHistoryScope): Promise<ChatTurn[]> {
  const res = await fetch(`/api/chat-history?scope=${encodeURIComponent(scope)}`, { cache: 'no-store' });
  const data = (await res.json().catch(() => ({}))) as { turns?: ChatTurn[] };
  return Array.isArray(data.turns) ? data.turns : [];
}

async function writeHistory(scope: ChatHistoryScope, turns: ChatTurn[]): Promise<ChatTurn[]> {
  const res = await fetch('/api/chat-history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, turns }),
  });
  const data = (await res.json().catch(() => ({}))) as { turns?: ChatTurn[] };
  return Array.isArray(data.turns) ? data.turns : turns;
}

export function AgentChat({
  variant = 'panel',
  historyScope = 'hub',
  title = 'Architect Chat',
  lanes = ['CLAUDE', 'CODEX'],
  defaultLane,
  selectedLane,
  onLaneChange,
  emptyText,
}: {
  variant?: 'panel' | 'full';
  historyScope?: ChatHistoryScope;
  title?: string;
  lanes?: AgentChatLane[];
  defaultLane?: AgentChatLane;
  selectedLane?: AgentChatLane;
  onLaneChange?: (lane: AgentChatLane) => void;
  emptyText?: string;
}) {
  const laneKey = lanes.join('|');
  const availableLanes = useMemo(() => (lanes.length > 0 ? lanes : ['CLAUDE' as AgentChatLane]), [laneKey]);
  const initialLane = defaultLane && availableLanes.includes(defaultLane) ? defaultLane : availableLanes[0];
  const [lane, setLane] = useState<AgentChatLane>(initialLane);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [value, setValue] = useState('');
  const [speakOn, setSpeakOn] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const setCoreListening = useCoreFxStore((s) => s.setIsListening);

  const chooseLane = useCallback(
    (next: AgentChatLane) => {
      setLane(next);
      onLaneChange?.(next);
    },
    [onLaneChange],
  );

  useEffect(() => {
    if (!availableLanes.includes(lane)) chooseLane(initialLane);
  }, [availableLanes, chooseLane, initialLane, lane]);

  useEffect(() => {
    if (selectedLane && availableLanes.includes(selectedLane)) setLane(selectedLane);
  }, [availableLanes, selectedLane]);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    void readHistory(historyScope)
      .then((history) => {
        if (alive) setTurns(history);
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [historyScope]);

  useEffect(() => {
    const onHistoryUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ scope?: ChatHistoryScope; turns?: ChatTurn[] }>).detail;
      if (detail?.scope && detail.scope !== historyScope) return;
      if (Array.isArray(detail?.turns)) {
        setTurns(detail.turns);
        setLoaded(true);
        return;
      }
      void readHistory(historyScope).then((history) => {
        setTurns(history);
        setLoaded(true);
      });
    };

    window.addEventListener(CHAT_HISTORY_UPDATED_EVENT, onHistoryUpdated);
    return () => window.removeEventListener(CHAT_HISTORY_UPDATED_EVENT, onHistoryUpdated);
  }, [historyScope]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns.length, busy]);

  const persist = useCallback(
    async (next: ChatTurn[]) => {
      setTurns(next);
      try {
        const saved = await writeHistory(historyScope, next);
        setTurns(saved);
      } catch {
        console.warn(`[${historyScope}] chat history save failed`);
      }
    },
    [historyScope],
  );

  const submit = useCallback(
    async (override?: string, options?: { forceSpeak?: boolean }) => {
      const prompt = (override ?? value).trim();
      if (!prompt || busy) return;

      const config = LANE_CONFIG[lane];
      const history = turns
        .filter((t) => !t.error)
        .slice(-18)
        .map(({ role, content }) => ({ role, content }));
      const userTurn: ChatTurn = { role: 'user', content: prompt, createdAt: new Date().toISOString() };
      const base = [...turns, userTurn];

      setValue('');
      setBusy(true);
      setTurns(base);

      try {
        if (config.mode === 'claude') {
          const res = await fetch('/api/converse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: prompt,
              history,
              scope: historyScope,
              persona: config.persona ?? 'architect',
            }),
          });
          const data = (await res.json().catch(() => ({}))) as {
            reply?: string;
            error?: string;
            history?: ChatTurn[];
            brain?: { model?: string };
          };
          const reply = data.reply || data.error || 'I could not respond.';
          if (Array.isArray(data.history)) {
            setTurns(data.history);
          } else {
            await persist([
              ...base,
              {
                role: 'assistant',
                content: reply,
                agentId: config.label.split(' ')[0],
                model: data.brain?.model,
                error: Boolean(data.error),
                createdAt: new Date().toISOString(),
              },
            ]);
          }
          if ((speakOn || options?.forceSpeak) && !data.error) speakBrowser(reply);
          return;
        }

        const agentId = config.agentId ?? 'CODEX';
        const result = await dispatchAgent({ agentId, prompt, history });
        const reply = result.error ?? result.content;
        const next = [
          ...base,
          {
            role: 'assistant' as const,
            content: reply,
            agentId: result.agentId,
            model: result.modelUsed,
            error: Boolean(result.error),
            materialized: result.materialized,
            createdAt: new Date().toISOString(),
          },
        ];
        await persist(next);
        if ((speakOn || options?.forceSpeak) && !result.error) speakBrowser(result.content);
      } catch (err) {
        await persist([
          ...base,
          {
            role: 'assistant',
            content: err instanceof Error ? err.message : 'dispatch failed',
            agentId: lane,
            error: true,
            createdAt: new Date().toISOString(),
          },
        ]);
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [busy, historyScope, lane, persist, speakOn, turns, value],
  );

  const speech = useSpeechRecognition((text) => {
    setValue(text);
    void submit(text, { forceSpeak: true });
  });

  useEffect(() => {
    setCoreListening(speech.state === 'listening');
    return () => setCoreListening(false);
  }, [setCoreListening, speech.state]);

  useEffect(() => {
    if (speech.state === 'listening' && speech.transcript) setValue(speech.transcript);
  }, [speech.state, speech.transcript]);

  const activeConfig = LANE_CONFIG[lane];
  const placeholder = speech.state === 'listening'
    ? 'Listening...'
    : activeConfig.mode === 'codex'
      ? 'Ask Codex to build, review, or debug...'
      : `Message ${activeConfig.label}...`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={cn(
          'flex shrink-0 items-center gap-2 border-b border-border',
          variant === 'full' ? 'h-11 px-4' : 'pb-1.5',
        )}
      >
        <Bot className="size-3.5 shrink-0 text-primary" aria-hidden />
        <span className={cn(variant === 'full' ? 'font-display text-sm font-semibold tracking-wide text-foreground/90' : 'text-[10px] uppercase tracking-widest text-muted-foreground')}>
          {title}
        </span>
        <select
          value={lane}
          onChange={(e) => chooseLane(e.target.value as AgentChatLane)}
          aria-label="Brain lane"
          title={activeConfig.description}
          className="ml-1 min-w-0 max-w-[230px] rounded border border-border bg-surface-1 px-1.5 py-0.5 font-terminal text-[10px] text-foreground outline-none focus:border-primary/40"
        >
          {availableLanes.map((id) => (
            <option key={id} value={id}>
              {LANE_CONFIG[id].label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setSpeakOn((s) => !s)}
          aria-pressed={speakOn}
          title={speakOn ? 'Replies are spoken aloud' : 'Replies are text-only'}
          className={cn(
            'ml-auto flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 font-terminal text-[9px] transition-colors',
            speakOn ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
          )}
        >
          {speakOn ? <Volume2 className="size-2.5" aria-hidden /> : <VolumeX className="size-2.5" aria-hidden />}
          {speakOn ? 'SPEAK' : 'TEXT'}
        </button>
      </div>

      <div ref={scrollRef} className={cn('min-h-0 flex-1 space-y-2.5 overflow-y-auto py-2.5', variant === 'full' && 'px-4')}>
        {!loaded ? (
          <div className="mt-6 text-center font-terminal text-[10px] text-muted-foreground/40">loading history...</div>
        ) : turns.length === 0 ? (
          <div className="mt-6 px-2 text-center font-terminal text-[10px] leading-relaxed text-muted-foreground/50">
            {emptyText ?? activeConfig.description}
          </div>
        ) : (
          turns.map((turn, i) => {
            const isUser = turn.role === 'user';
            return (
              <div key={`${turn.createdAt ?? i}-${i}`} className={cn('flex gap-2', isUser ? 'justify-end pr-0.5' : 'justify-start pl-0.5')}>
                {!isUser && (
                  <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10">
                    <Bot className="size-2.5 text-primary" aria-hidden />
                  </div>
                )}
                <div
                  className={cn(
                    'max-w-[80%] rounded-lg px-2.5 py-1.5 text-xs leading-relaxed',
                    isUser
                      ? 'bg-surface-3 text-foreground'
                      : turn.error
                        ? 'border border-neon-red/30 bg-neon-red/[0.05] text-neon-red/90'
                        : 'border border-border bg-surface-1 text-foreground/90',
                  )}
                >
                  {!isUser && turn.agentId && (
                    <p className="mb-0.5 font-terminal text-[9px] uppercase tracking-wider text-muted-foreground/50">
                      {turn.agentId}
                      {turn.model ? ` · ${shortModel(turn.model)}` : ''}
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
                            m.type === 'staged_order' ? 'border-neon-green/40 text-neon-green/80' : 'border-primary/40 text-primary/80',
                          )}
                        >
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
          })
        )}
        {busy && (
          <div className="flex items-center gap-2 font-terminal text-[10px] text-muted-foreground/60">
            <span className="size-1.5 animate-pulse rounded-full bg-primary" aria-hidden /> thinking...
          </div>
        )}
      </div>

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
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            suppressHydrationWarning
            aria-label={`${title} prompt`}
            className="max-h-28 flex-1 resize-none bg-transparent font-terminal text-xs text-foreground placeholder:text-muted-foreground/25 outline-none"
          />
          <button
            type="button"
            onClick={speech.state === 'listening' ? speech.stop : speech.start}
            disabled={!speech.isSupported || busy}
            aria-pressed={speech.state === 'listening'}
            aria-label={speech.state === 'listening' ? 'Stop voice input' : 'Start voice input'}
            title={!speech.isSupported ? 'Voice input is not supported in this browser' : speech.state === 'listening' ? 'Stop voice input' : 'Start voice input'}
            className={cn(
              'flex shrink-0 items-center rounded p-0.5 transition-colors',
              speech.state === 'listening' ? 'text-amber-400' : speech.isSupported ? 'text-emerald-500 hover:text-emerald-400' : 'cursor-not-allowed text-muted-foreground/25',
            )}
          >
            {speech.state === 'processing' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : speech.state === 'listening' ? <MicOff className="size-3.5" aria-hidden /> : <Mic className="size-3.5" aria-hidden />}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!value.trim() || busy}
            aria-label="Send prompt"
            className={cn(
              'flex shrink-0 items-center rounded transition-colors',
              value.trim() && !busy ? 'text-emerald-500 hover:text-emerald-400' : 'cursor-not-allowed text-muted-foreground/25',
            )}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Send className="size-3.5" aria-hidden />}
          </button>
        </div>
      </div>
    </div>
  );
}

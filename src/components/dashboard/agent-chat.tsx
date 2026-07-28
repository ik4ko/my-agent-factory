'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Loader2, Mic, MicOff, Send, User, Volume2, VolumeX } from 'lucide-react';
import { dispatchAgent, type MaterializedArtifact } from '@/app/actions/agent-dispatcher';
import {
  confirmLifeContextProposal,
  discardLifeContextProposal,
  editLifeContextProposal,
  listLifeContext,
} from '@/app/actions/life-context';
import { recordMentorThumb } from '@/app/actions/feedback';
import type { ActiveBrainId } from '@/lib/agents/brain-matrix';
import { useCoreFxStore } from '@/lib/fx/core-store';
import { CHAT_HISTORY_UPDATED_EVENT } from '@/lib/chat/events';
import { speakBrowser } from '@/hooks/use-browser-speech';
import { useSpeechRecognition } from '@/hooks/use-speech-recognition';
import { shortModel } from '@/lib/telemetry/pricing';
import type { ChatHistoryScope } from '@/lib/chat/history';
import { MENTOR_LANES, type MentorLaneId } from '@/lib/chat/mentor-lanes';
import { usePersonalLaneStore, type PersonalLane } from '@/lib/chat/lane-store';
import { cn } from '@/lib/utils';
import { LIFE_CONTEXT_UPDATED_EVENT } from '@/lib/life-context/events';
import type { PendingLifeContextProposal } from '@/lib/life-context/types';

type ClaudePersona = 'architect' | 'trading' | 'coding' | 'business_mentor' | 'life_mentor' | 'focus_mentor';
export type AgentChatLane = 'CLAUDE' | 'CODEX' | 'TRADING' | MentorLaneId;

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
  /** 'claude' → /api/converse (CEO + persona appendix); 'dispatch' → dispatchAgent (brain-matrix lane). */
  mode: 'claude' | 'dispatch';
  persona?: ClaudePersona;
  agentId?: ActiveBrainId;
  /** Dedicated history scope — overrides the room's historyScope prop.
   *  Mentor lanes each get their own so conversations never cross mentors. */
  historyScope?: ChatHistoryScope;
}

function mentorLaneConfig(id: MentorLaneId): LaneConfig {
  const lane = MENTOR_LANES[id];
  return {
    label: lane.label,
    description: lane.description,
    mode: 'dispatch',
    agentId: lane.agentId,
    historyScope: lane.scope,
  };
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
    mode: 'dispatch',
    agentId: 'CODEX',
  },
  TRADING: {
    label: 'CLAUDE · trading',
    description: 'Trading analysis only; staged/dry-run language stays explicit.',
    mode: 'claude',
    persona: 'trading',
  },
  MENTOR_BUSINESS: mentorLaneConfig('MENTOR_BUSINESS'),
  MENTOR_MONEY: mentorLaneConfig('MENTOR_MONEY'),
  MENTOR_LIFE: mentorLaneConfig('MENTOR_LIFE'),
  MENTOR_HEALTH: mentorLaneConfig('MENTOR_HEALTH'),
};

/** Parse the converse SSE stream: forward accumulated reply text per delta,
 *  return the authoritative `done` payload (same shape as the JSON mode). */
async function consumeConverseStream(
  body: ReadableStream<Uint8Array>,
  onPartial: (text: string) => void,
): Promise<{ reply?: string; error?: string; history?: ChatTurn[]; brain?: { model?: string } }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let frames = '';
  let accumulated = '';
  let final: { reply?: string; error?: string; history?: ChatTurn[]; brain?: { model?: string } } = {};
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      frames += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = frames.indexOf('\n\n')) !== -1) {
        const frame = frames.slice(0, sep);
        frames = frames.slice(sep + 2);
        const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
        if (!dataLine) continue;
        let event: { type?: string; text?: string; error?: string } & Record<string, unknown>;
        try {
          event = JSON.parse(dataLine.slice(6));
        } catch {
          continue;
        }
        if (event.type === 'delta' && typeof event.text === 'string') {
          accumulated += event.text;
          onPartial(accumulated);
        } else if (event.type === 'done') {
          final = event as typeof final;
        } else if (event.type === 'error') {
          final = { error: typeof event.error === 'string' ? event.error : 'converse failed' };
        }
      }
    }
  } catch {
    // Mid-stream network failure: surface what we know rather than hanging.
    if (!final.reply && !final.error) final = { error: 'stream interrupted' };
  }
  return final;
}

async function consumeDispatchStream(
  body: ReadableStream<Uint8Array>,
  onPartial: (text: string) => void,
): Promise<Awaited<ReturnType<typeof dispatchAgent>>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let frames = '';
  let accumulated = '';
  let final: Awaited<ReturnType<typeof dispatchAgent>> | null = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      frames += decoder.decode(value, { stream: true });
      let separator: number;
      while ((separator = frames.indexOf('\n\n')) !== -1) {
        const frame = frames.slice(0, separator);
        frames = frames.slice(separator + 2);
        const line = frame.split('\n').find((item) => item.startsWith('data: '));
        if (!line) continue;
        const event = JSON.parse(line.slice(6)) as Record<string, unknown>;
        if (event.type === 'delta' && typeof event.text === 'string') {
          accumulated += event.text;
          onPartial(accumulated);
        } else if (event.type === 'done') {
          final = event as unknown as Awaited<ReturnType<typeof dispatchAgent>>;
        } else if (event.type === 'error') {
          throw new Error(typeof event.error === 'string' ? event.error : 'dispatch failed');
        }
      }
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error('stream interrupted');
  }
  if (!final) throw new Error('stream interrupted before final result');
  return final;
}

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
  /** Accumulating streamed reply (claude/SSE mode) — rendered as a
   *  provisional bubble, replaced by the persisted turn on completion. */
  const [streamText, setStreamText] = useState<string | null>(null);
  /** True while a submit is in flight — history-updated events must not
   *  clobber the optimistic user turn / streaming bubble mid-request. */
  const inFlightRef = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [value, setValue] = useState('');
  const [speakOn, setSpeakOn] = useState(false);
  const [pendingFacts, setPendingFacts] = useState<PendingLifeContextProposal[]>([]);
  const [pendingFactAction, setPendingFactAction] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const setCoreListening = useCoreFxStore((s) => s.setIsListening);
  const setPersonalLane = usePersonalLaneStore((s) => s.setPersonalLane);
  /** Feedback thumbs already given this session, keyed per rendered turn. */
  const [ratedTurns, setRatedTurns] = useState<Record<string, 'up' | 'down'>>({});

  const rateTurn = useCallback((turnKey: string, turn: ChatTurn, verdict: 'up' | 'down') => {
    const note = verdict === 'down' ? window.prompt('What was wrong? (optional)') ?? undefined : undefined;
    setRatedTurns((prev) => ({ ...prev, [turnKey]: verdict }));
    void recordMentorThumb({
      mentorId: turn.agentId ?? 'unknown',
      verdict,
      ...(turn.model ? { model: turn.model } : {}),
      ...(note?.trim() ? { note: note.trim() } : {}),
    }).catch(() => setRatedTurns((prev) => {
      const next = { ...prev };
      delete next[turnKey];
      return next;
    }));
  }, []);

  // A lane with its own historyScope (mentor lanes) overrides the room scope.
  // Everything below — load, live-update events, persistence — keys on this,
  // so choosing a lane swaps persona AND history together: the load effect
  // clears `loaded`, and submit refuses to run until the right history is in.
  const effectiveScope = LANE_CONFIG[lane].historyScope ?? historyScope;

  useEffect(() => {
    if (historyScope === 'personal' && (lane === 'CLAUDE' || lane in MENTOR_LANES)) {
      setPersonalLane(lane as PersonalLane);
    }
  }, [historyScope, lane, setPersonalLane]);

  const chooseLane = useCallback(
    (next: AgentChatLane) => {
      setLane(next);
      onLaneChange?.(next);
    },
    [onLaneChange],
  );

  useEffect(() => {
    // Intentional synchronisation with an external/prop change. The guard above
    // makes this a no-op unless the value actually changed, so it settles in one
    // extra render rather than cascading.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!availableLanes.includes(lane)) chooseLane(initialLane);
  }, [availableLanes, chooseLane, initialLane, lane]);

  useEffect(() => {
    // Intentional synchronisation with an external/prop change. The guard above
    // makes this a no-op unless the value actually changed, so it settles in one
    // extra render rather than cascading.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (selectedLane && availableLanes.includes(selectedLane)) setLane(selectedLane);
  }, [availableLanes, selectedLane]);

  useEffect(() => {
    let alive = true;
    // Data fetch on mount. The loader is async and sets state around an await;
    // this is React's documented pattern for loading data in a client component,
    // not derived state feeding a cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoaded(false);
    void readHistory(effectiveScope)
      .then((history) => {
        if (alive) setTurns(history);
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [effectiveScope]);

  const refreshLifeContext = useCallback(() => {
    if (historyScope !== 'personal') return;
    void listLifeContext().then((document) => setPendingFacts(document.pending)).catch(() => undefined);
  }, [historyScope]);

  useEffect(() => {
    refreshLifeContext();
    window.addEventListener(LIFE_CONTEXT_UPDATED_EVENT, refreshLifeContext);
    return () => window.removeEventListener(LIFE_CONTEXT_UPDATED_EVENT, refreshLifeContext);
  }, [refreshLifeContext]);

  const actOnFact = useCallback(async (proposal: PendingLifeContextProposal, action: 'confirm' | 'edit' | 'discard') => {
    setPendingFactAction(proposal.id);
    try {
      if (action === 'confirm') await confirmLifeContextProposal(proposal.id);
      if (action === 'discard') await discardLifeContextProposal(proposal.id);
      if (action === 'edit') {
        const value = window.prompt('Edit the fact before confirming it:', proposal.candidate.value);
        if (value === null) return;
        await editLifeContextProposal(proposal.id, { ...proposal.candidate, value });
      }
      refreshLifeContext();
    } finally {
      setPendingFactAction(null);
    }
  }, [refreshLifeContext]);

  useEffect(() => {
    const onHistoryUpdated = (event: Event) => {
      // A voice command or background delegation landing mid-submit must not
      // overwrite the optimistic user turn or an in-progress stream; the
      // submit's own finalize sets the fresh server history.
      if (inFlightRef.current) return;
      const detail = (event as CustomEvent<{ scope?: ChatHistoryScope; turns?: ChatTurn[] }>).detail;
      if (detail?.scope && detail.scope !== effectiveScope) return;
      if (Array.isArray(detail?.turns)) {
        setTurns(detail.turns);
        setLoaded(true);
        return;
      }
      void readHistory(effectiveScope).then((history) => {
        setTurns(history);
        setLoaded(true);
      });
    };

    window.addEventListener(CHAT_HISTORY_UPDATED_EVENT, onHistoryUpdated);
    return () => window.removeEventListener(CHAT_HISTORY_UPDATED_EVENT, onHistoryUpdated);
  }, [effectiveScope]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns.length, busy]);

  const persist = useCallback(
    async (next: ChatTurn[]) => {
      setTurns(next);
      try {
        const saved = await writeHistory(effectiveScope, next);
        setTurns(saved);
      } catch {
        console.warn(`[${effectiveScope}] chat history save failed`);
      }
    },
    [effectiveScope],
  );

  const submit = useCallback(
    async (override?: string, options?: { forceSpeak?: boolean }) => {
      const prompt = (override ?? value).trim();
      // `!loaded` guard: after a lane switch, `turns` may still hold the
      // previous lane's history until the reload lands — sending then would
      // persist that history into the NEW lane's scope (cross-mentor leak).
      if (!prompt || busy || !loaded) return;

      const config = LANE_CONFIG[lane];
      const history = turns
        .filter((t) => !t.error)
        .slice(-18)
        .map(({ role, content }) => ({ role, content }));
      const userTurn: ChatTurn = { role: 'user', content: prompt, createdAt: new Date().toISOString() };
      const base = [...turns, userTurn];

      setValue('');
      setBusy(true);
      inFlightRef.current = true;
      setTurns(base);

      try {
        if (config.mode === 'claude') {
          // ?stream=1: the server streams reply deltas as SSE when it can
          // (CEO lane); trading-gate / budget-block / error outcomes still
          // come back as plain JSON — branch on the response content type.
          const res = await fetch('/api/converse?stream=1', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: prompt,
              history,
              scope: effectiveScope,
              persona: config.persona ?? 'architect',
            }),
          });

          let data: { reply?: string; error?: string; history?: ChatTurn[]; brain?: { model?: string } } = {};
          if (res.ok && res.body && (res.headers.get('content-type') ?? '').includes('text/event-stream')) {
            data = await consumeConverseStream(res.body, (partial) => setStreamText(partial));
          } else {
            data = (await res.json().catch(() => ({}))) as typeof data;
          }

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
        const dispatchResponse = await fetch('/api/agent-dispatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId, prompt, history }),
        });
        let result: Awaited<ReturnType<typeof dispatchAgent>>;
        if (dispatchResponse.ok && dispatchResponse.body && (dispatchResponse.headers.get('content-type') ?? '').includes('text/event-stream')) {
          result = await consumeDispatchStream(dispatchResponse.body, (partial) => setStreamText(partial));
        } else {
          result = await dispatchResponse.json().catch(() => ({
            agentId,
            modelUsed: 'unknown',
            content: '',
            timestamp: new Date().toISOString(),
            error: `dispatch request failed (${dispatchResponse.status})`,
          })) as Awaited<ReturnType<typeof dispatchAgent>>;
        }
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
        if (result.lifeContextProposals?.length) refreshLifeContext();
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
        inFlightRef.current = false;
        setStreamText(null);
        inputRef.current?.focus();
      }
    },
    [busy, effectiveScope, lane, loaded, persist, refreshLifeContext, speakOn, turns, value],
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
    // Intentional synchronisation with an external/prop change. The guard above
    // makes this a no-op unless the value actually changed, so it settles in one
    // extra render rather than cascading.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (speech.state === 'listening' && speech.transcript) setValue(speech.transcript);
  }, [speech.state, speech.transcript]);

  const activeConfig = LANE_CONFIG[lane];
  const placeholder = speech.state === 'listening'
    ? 'Listening...'
    : lane === 'CODEX'
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
                    'max-w-[78%] rounded-[9px] px-[14px] py-[10px] text-xs leading-relaxed',
                    isUser
                      ? 'border border-primary/25 bg-primary/[0.08] text-foreground'
                      : turn.error
                        ? 'border border-neon-red/30 bg-neon-red/[0.05] text-neon-red/90'
                        : 'border border-border/[0.1] bg-white/[0.02] text-foreground/90',
                  )}
                >
                  {!isUser && turn.agentId && (
                    <p className="mb-0.5 font-terminal text-[9px] uppercase tracking-wider text-muted-foreground/50">
                      {turn.agentId}
                      {turn.model ? ` · ${shortModel(turn.model)}` : ''}
                    </p>
                  )}
                  <span className="whitespace-pre-wrap break-words">{turn.content}</span>
                  {!isUser && !turn.error && turn.agentId?.startsWith('MENTOR_') && (
                    <div className="mt-1 flex gap-1.5">
                      {(['up', 'down'] as const).map((verdict) => {
                        const turnKey = `${turn.createdAt ?? i}-${i}`;
                        const chosen = ratedTurns[turnKey];
                        return (
                          <button
                            key={verdict}
                            type="button"
                            disabled={chosen !== undefined}
                            aria-label={verdict === 'up' ? 'Good reply' : 'Bad reply'}
                            title={verdict === 'up' ? 'Good reply' : 'Bad reply (optional note)'}
                            onClick={() => rateTurn(turnKey, turn, verdict)}
                            className={cn(
                              'rounded px-1 font-terminal text-[10px] transition-colors',
                              chosen === verdict
                                ? 'bg-primary/20 text-primary'
                                : chosen !== undefined
                                  ? 'text-muted-foreground/20'
                                  : 'text-muted-foreground/50 hover:text-foreground',
                            )}
                          >
                            {verdict === 'up' ? '👍' : '👎'}
                          </button>
                        );
                      })}
                    </div>
                  )}
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
        {busy && streamText !== null && (
          /* Provisional streamed reply — replaced by the persisted turn when
             the authoritative done payload lands. */
          <div className="flex justify-start gap-2 pl-0.5">
            <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10">
              <Bot className="size-2.5 text-primary" aria-hidden />
            </div>
            <div className="max-w-[80%] rounded-lg border border-border bg-surface-1 px-2.5 py-1.5 text-xs leading-relaxed text-foreground/90">
              <span className="whitespace-pre-wrap break-words">{streamText}</span>
              <span className="ml-0.5 inline-block size-1.5 animate-pulse rounded-full bg-primary align-middle" aria-hidden />
            </div>
          </div>
        )}
        {busy && streamText === null && (
          <div className="flex items-center gap-2 font-terminal text-[10px] text-muted-foreground/60">
            <span className="size-1.5 animate-pulse rounded-full bg-primary" aria-hidden /> thinking...
          </div>
        )}
      </div>

      <div className={cn('shrink-0 border-t border-border pt-2', variant === 'full' && 'px-4 pb-3')}>
        {historyScope === 'personal' && pendingFacts.length > 0 && (
          <div className="mb-2 space-y-2">
            {pendingFacts.map((proposal) => (
              <div key={proposal.id} className="rounded-md border border-amber-400/30 bg-amber-400/[0.06] p-2 font-terminal text-[10px]">
                <p className="text-amber-200">Remember this shared fact?</p>
                <p className="mt-1 text-foreground/85">{proposal.candidate.subject}: {proposal.candidate.value}</p>
                <p className="mt-1 text-muted-foreground/60">Source: “{proposal.candidate.sourceQuote}” · expires in 24h</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={pendingFactAction === proposal.id} onClick={() => void actOnFact(proposal, 'confirm')} className="text-emerald-400 hover:text-emerald-300">Confirm</button>
                  <button type="button" disabled={pendingFactAction === proposal.id} onClick={() => void actOnFact(proposal, 'edit')} className="text-primary hover:text-primary/80">Edit</button>
                  <button type="button" disabled={pendingFactAction === proposal.id} onClick={() => void actOnFact(proposal, 'discard')} className="text-muted-foreground hover:text-foreground">Discard</button>
                </div>
              </div>
            ))}
          </div>
        )}
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
            disabled={!value.trim() || busy || !loaded}
            aria-label="Send prompt"
            className={cn(
              'flex shrink-0 items-center rounded transition-colors',
              value.trim() && !busy && loaded ? 'text-emerald-500 hover:text-emerald-400' : 'cursor-not-allowed text-muted-foreground/25',
            )}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Send className="size-3.5" aria-hidden />}
          </button>
        </div>
      </div>
    </div>
  );
}

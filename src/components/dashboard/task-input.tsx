'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Mic, MicOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCoreFxStore } from '@/lib/fx/core-store';
import type { HermesResult } from '@/lib/hermes/types';
import type { PipelineRunResponse } from '@/lib/pipeline/types';
import { pushSystemFeed } from '@/lib/fx/system-feed';

type TraceKind = 'ok' | 'error';
interface Trace {
  kind: TraceKind;
  text: string;
  id: number;
}

type VoiceState = 'idle' | 'listening' | 'processing';

// Web Speech API is not in every lib.dom version - loose typing, SSR-guarded.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecognition = any;
function getSpeechRecognitionCtor(): AnyRecognition | null {
  if (typeof window === 'undefined') return null; // hard SSR boundary
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const WAKE = /\bhey\s+hermes\b|\bhermes\b/i;
const SILENCE_MS = 2500;

const VOICE_LABEL: Record<VoiceState, string> = {
  idle: '[ IDLE ]',
  listening: '[ LISTENING ]',
  processing: '[ PROCESSING ]',
};

// Staggered analyzer bars - inline animationDelay so each bar dances offbeat.
const BAR_DELAYS = ['0ms', '120ms', '240ms', '360ms', '180ms'];

function SoundWaveform() {
  return (
    <span className="flex items-end gap-[2px] h-3.5" aria-hidden="true">
      {BAR_DELAYS.map((delay, i) => (
        <span
          key={i}
          className="w-[2px] h-full origin-bottom rounded-full bg-amber-400 animate-waveform"
          style={{ animationDelay: delay }}
        />
      ))}
    </span>
  );
}

function ProcessingRing() {
  return (
    <span className="relative inline-flex size-3.5" aria-hidden="true">
      <span className="absolute inset-0 rounded-full border border-cyan-400/25" />
      <span className="absolute inset-0 rounded-full border-t border-r border-cyan-400 animate-spin" />
    </span>
  );
}

function DotMatrix() {
  return (
    <span className="flex items-center gap-[3px]" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-[3px] rounded-full bg-emerald-500/40" />
      ))}
    </span>
  );
}

export function TaskInput() {
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const [trace, setTrace] = useState<Trace | null>(null);

  const [voiceSupported, setVoiceSupported] = useState(false);
  const [armed, setArmed] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [wakeGlow, setWakeGlow] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const recogRef = useRef<AnyRecognition>(null);
  const armedRef = useRef(false);
  const capturingRef = useRef(false);
  const silenceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef('');
  valueRef.current = value;
  const pendingRef = useRef(false);

  useEffect(() => {
    setVoiceSupported(getSpeechRecognitionCtor() !== null);
  }, []);

  // Producer: mirror live voice state into the CinematicCore FX bridge so
  // the particle sphere warps into the waveform while listening, and emit
  // terminal diagnostics on arm/disarm transitions only (not every render).
  const setCoreListening = useCoreFxStore((s) => s.setIsListening);
  const prevListeningRef = useRef(false);
  useEffect(() => {
    const listening = voiceState === 'listening';
    setCoreListening(listening);
    if (listening !== prevListeningRef.current) {
      prevListeningRef.current = listening;
      pushSystemFeed(
        'VOICE',
        listening
          ? 'Microphone armed — frequency waveform capture live'
          : 'Microphone released — core re-forming idle sphere',
      );
    }
    return () => setCoreListening(false);
  }, [voiceState, setCoreListening]);

  useEffect(() => {
    if (!trace) return;
    const t = setTimeout(() => setTrace(null), 5000);
    return () => clearTimeout(t);
  }, [trace]);

  const submit = useCallback(async (raw: string) => {
    const prompt = raw.trim();
    if (!prompt || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setVoiceState((s) => (armedRef.current ? 'processing' : s));

    // "/run <objective>" launches the LIVE multi-agent pipeline;
    // "/sim <objective>" launches the sandbox chain. Everything else falls
    // through to the standard single-task Hermes dispatcher below.
    const pipelineMatch = prompt.match(/^\/(run|sim)(?:\s+(.*))?$/is);
    if (pipelineMatch) {
      const simulate = pipelineMatch[1].toLowerCase() === 'sim';
      const objective = (pipelineMatch[2] ?? '').trim();
      try {
        if (!objective) {
          throw new Error('usage: /run <objective> (live) or /sim <objective> (sandbox)');
        }
        pushSystemFeed(
          'DISPATCH',
          `Pipeline launch — ${simulate ? 'SANDBOX' : 'LIVE'} chain: "${objective.slice(0, 48)}${objective.length > 48 ? '…' : ''}"`,
        );
        const res = await fetch('/api/pipeline/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ objective, simulate }),
        });
        const data = (await res.json().catch(() => ({}))) as Partial<PipelineRunResponse> & {
          error?: string;
        };
        if (!res.ok || !data.pipelineId || !data.firstStage) {
          throw new Error(data.error ?? `pipeline failed (${res.status})`);
        }
        setValue('');
        pushSystemFeed(
          'SYSTEM',
          `Pipeline ${data.pipelineId.slice(0, 8)} online — stage 1 ${data.firstStage.role} → ${data.firstStage.agent}`,
        );
        setTrace({
          kind: 'ok',
          text: `pipeline ${data.pipelineId.slice(0, 8)} started - ${data.firstStage.role} → ${data.firstStage.agent}`,
          id: Date.now(),
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'pipeline launch failed';
        pushSystemFeed('SYSTEM', `Pipeline launch rejected — ${reason}`);
        setTrace({ kind: 'error', text: reason, id: Date.now() });
      } finally {
        pendingRef.current = false;
        setPending(false);
        if (armedRef.current) setVoiceState('listening');
        inputRef.current?.focus();
      }
      return;
    }

    const t0 = performance.now();
    pushSystemFeed('DISPATCH', `Command accepted — routing "${prompt.slice(0, 48)}${prompt.length > 48 ? '…' : ''}" to intent parser`);
    try {
      // Route through the Hermes orchestration layer: intent parsing →
      // idle-agent lookup → task creation → worker dispatch. Status flips
      // and log output flow back via the existing Supabase realtime
      // channels (agents/tasks/logs) — no polling needed here.
      const res = await fetch('/api/hermes/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: prompt,
          issuedAt: new Date().toISOString(),
          target: { status: 'idle' },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<HermesResult> & {
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `command failed (${res.status})`);
      if (data.status !== 'dispatched' || !data.taskId) {
        throw new Error(data.message ?? 'dispatch failed');
      }
      setValue('');
      const agentLabel = data.agentName ?? data.agentId?.slice(0, 8) ?? 'agent';
      pushSystemFeed('NETWORK', `Telemetry pipeline established (latency: ${Math.round(performance.now() - t0)}ms)`);
      pushSystemFeed('SYSTEM', `Synchronizing task matrix — ${agentLabel} assigned task ${data.taskId.slice(0, 8)}`);
      setTrace({
        kind: 'ok',
        text: `dispatched to ${agentLabel} - task ${data.taskId.slice(0, 8)}`,
        id: Date.now(),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'queue failed';
      pushSystemFeed('SYSTEM', `Dispatch rejected — ${reason}`);
      setTrace({ kind: 'error', text: reason, id: Date.now() });
    } finally {
      pendingRef.current = false;
      setPending(false);
      if (armedRef.current) setVoiceState('listening');
      inputRef.current?.focus();
    }
  }, []);

  const clearSilence = () => {
    if (silenceRef.current) {
      clearTimeout(silenceRef.current);
      silenceRef.current = null;
    }
  };

  const armSilenceDispatch = useCallback(() => {
    clearSilence();
    silenceRef.current = setTimeout(() => {
      const payload = valueRef.current.trim();
      capturingRef.current = false;
      setWakeGlow(false);
      if (payload) void submit(payload);
    }, SILENCE_MS);
  }, [submit]);

  const stopVoice = useCallback(() => {
    armedRef.current = false;
    setArmed(false);
    capturingRef.current = false;
    setWakeGlow(false);
    setVoiceState('idle');
    clearSilence();
    try {
      recogRef.current?.stop();
    } catch {
      /* already stopped */
    }
  }, []);

  const startVoice = useCallback(async () => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    // Preflight: force the browser's mic permission prompt and surface the
    // real reason on failure (SpeechRecognition alone can fail silently).
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop()); // permission only; recognition owns the mic
    } catch (err) {
      const name = err instanceof DOMException ? err.name : 'unknown';
      setTrace({
        kind: 'error',
        text:
          name === 'NotAllowedError'
            ? 'mic denied for localhost:9002 - icon left of URL > Site settings > Microphone > Allow, then reload'
            : name === 'NotFoundError'
              ? 'no microphone device found'
              : `mic unavailable (${name}) - text mode`,
        id: Date.now(),
      });
      return;
    }

    let recog: AnyRecognition;
    try {
      recog = new Ctor();
    } catch {
      setVoiceSupported(false);
      return;
    }
    recog.lang = 'en-US';
    recog.continuous = true;
    recog.interimResults = true;
    recog.maxAlternatives = 1;

    recog.onresult = (e: AnyRecognition) => {
      let combined = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        combined += e.results[i][0].transcript as string;
      }
      const match = WAKE.exec(combined);
      if (!capturingRef.current && match) {
        capturingRef.current = true;
        setWakeGlow(true);
      }
      if (capturingRef.current) {
        const after = combined.slice((match?.index ?? 0) + (match?.[0].length ?? 0));
        setValue(after.replace(/^[\s,.:;-]+/, ''));
        armSilenceDispatch();
      }
    };

    recog.onend = () => {
      if (armedRef.current) {
        try {
          recog.start();
        } catch {
          /* start races onend occasionally; ignore */
        }
      }
    };

    recog.onerror = (ev: AnyRecognition) => {
      const code = ev?.error as string | undefined;
      if (code === 'not-allowed') {
        stopVoice();
        setTrace({
          kind: 'error',
          text: 'mic blocked for this site - click the icon left of the URL > Site settings > Microphone > Allow, then reload',
          id: Date.now(),
        });
      } else if (code === 'service-not-allowed') {
        stopVoice();
        setTrace({
          kind: 'error',
          text: 'speech service unavailable in this browser - text mode',
          id: Date.now(),
        });
      } else if (code === 'network') {
        stopVoice();
        setTrace({
          kind: 'error',
          text: 'speech service unreachable (Chrome speech uses a network service) - text mode',
          id: Date.now(),
        });
      }
      // 'no-speech' / 'aborted' are benign - onend handles restart while armed.
    };

    recogRef.current = recog;
    armedRef.current = true;
    setArmed(true);
    setVoiceState('listening');
    try {
      recog.start();
    } catch {
      /* start() throws if already started; safe to ignore */
    }
  }, [armSilenceDispatch, stopVoice]);

  const onToggleVoice = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (armedRef.current) stopVoice();
      else void startVoice();
    },
    [startVoice, stopVoice]
  );

  useEffect(() => {
    return () => {
      armedRef.current = false;
      clearSilence();
      try {
        recogRef.current?.stop();
      } catch {
        /* noop */
      }
    };
  }, []);

  return (
    <div className="shrink-0 border-t border-border bg-[#0A0A0A] px-4 py-2.5 space-y-1">
      <div
        className={cn(
          'group relative flex items-center gap-2.5 rounded-md border border-l-2 border-border bg-[#0A0A0A]',
          'px-3 py-2.5 transition-all duration-300',
          'focus-within:border-emerald-500/50 focus-within:border-l-emerald-500',
          armed && 'border-amber-500 border-l-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.4)]',
          wakeGlow && 'animate-glow-pulse'
        )}
      >
        {pending ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-cyan-400" />
        ) : (
          <span
            className={cn(
              'select-none font-terminal text-sm font-bold leading-none',
              wakeGlow ? 'text-amber-500' : 'text-emerald-500'
            )}
          >
            {'>'}
          </span>
        )}

        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit(value);
          }}
          disabled={pending}
          placeholder={armed ? 'Say Hey Hermes or type...' : 'Queue a task for the fleet... (/run <objective> = live pipeline)'}
          autoComplete="off"
          spellCheck={false}
          suppressHydrationWarning={true}
          className={cn(
            'flex-1 bg-transparent font-terminal text-xs text-foreground',
            'placeholder:text-muted-foreground/25 outline-none disabled:opacity-60'
          )}
        />

        {voiceSupported && (
          <div
            role="button"
            tabIndex={0}
            onClick={onToggleVoice}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onToggleVoice(e as unknown as React.MouseEvent);
            }}
            suppressHydrationWarning={true}
            title={armed ? 'Disarm voice' : 'Arm Hey Hermes voice'}
            className="relative z-50 flex shrink-0 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 pointer-events-auto hover:bg-white/[0.03]"
          >
            <span
              suppressHydrationWarning={true}
              className={cn(
                'select-none font-terminal text-[10px] tracking-[0.18em] transition-colors duration-300',
                voiceState === 'idle' &&
                  'text-emerald-400 animate-pulse [text-shadow:0_0_15px_rgba(16,185,129,0.2)]',
                voiceState === 'listening' && 'text-amber-400',
                voiceState === 'processing' && 'text-cyan-400'
              )}
            >
              {VOICE_LABEL[voiceState]}
            </span>

            <span suppressHydrationWarning={true} className="flex items-center">
              {voiceState === 'idle' && <DotMatrix />}
              {voiceState === 'listening' && <SoundWaveform />}
              {voiceState === 'processing' && <ProcessingRing />}
            </span>

            <button
              type="button"
              onClick={onToggleVoice}
              suppressHydrationWarning={true}
              tabIndex={-1}
              aria-label={armed ? 'Disarm voice' : 'Arm voice'}
              className={cn(
                'pointer-events-auto shrink-0 rounded p-0.5 transition-colors duration-150',
                armed ? 'text-amber-400 hover:text-amber-300' : 'text-emerald-500/70 hover:text-emerald-400'
              )}
            >
              {armed ? <MicOff className="size-3.5" /> : <Mic className="size-3.5" />}
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => void submit(value)}
          disabled={!value.trim() || pending}
          suppressHydrationWarning={true}
          className={cn(
            'relative z-50 shrink-0 select-none font-terminal text-[10px] tracking-[0.2em] transition-colors duration-100',
            value.trim() && !pending ? 'text-emerald-500/80 hover:text-emerald-400' : 'text-muted-foreground/25 cursor-not-allowed'
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
            className={cn('px-1 font-terminal text-[10px]', trace.kind === 'ok' ? 'text-emerald-500' : 'text-neon-red')}
          >
            {trace.kind === 'ok' ? 'OK ' : 'X '}
            {trace.text}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

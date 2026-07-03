'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Mic, MicOff } from 'lucide-react';
import { cn } from '@/lib/utils';

type TraceKind = 'ok' | 'error';
interface Trace {
  kind: TraceKind;
  text: string;
  id: number;
}

type VoiceState = 'idle' | 'listening' | 'processing';

// Web Speech API is not in every lib.dom version — loose typing, SSR-guarded.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecognition = any;
function getSpeechRecognitionCtor(): AnyRecognition | null {
  if (typeof window === 'undefined') return null;
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

// Single terminal command dock + "Hey Hermes" wake-word voice engine. Queues a
// pending task via the auth-gated /api/tasks/create route (tasks has RLS on
// with no policies → no browser anon insert); lane router + triage take over.
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

  useEffect(() => {
    if (!trace) return;
    const t = setTimeout(() => setTrace(null), 5000);
    return () => clearTimeout(t);
  }, [trace]);

  const submit = useCallback(async (raw: string) => {
    const prompt = raw.trim();
    if (!prompt || pendingRef.current) return; // empty input → no-op
    pendingRef.current = true;
    setPending(true);
    setVoiceState((s) => (armedRef.current ? 'processing' : s));
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

  // Auto-dispatch after a silence gap once a wake-word capture is in flight.
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

  const startVoice = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return; // unsupported → text-only, no throw

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
        setWakeGlow(true); // amber pulse on wake
      }
      if (capturingRef.current) {
        const after = combined.slice((match?.index ?? 0) + (match?.[0].length ?? 0));
        setValue(after.replace(/^[\s,.:;-]+/, ''));
        armSilenceDispatch();
      }
    };

    recog.onend = () => {
      // Browsers stop continuous sessions periodically; restart while armed.
      if (armedRef.current) {
        try {
          recog.start();
        } catch {
          /* start races onend occasionally; ignore */
        }
      }
    };

    recog.onerror = (ev: AnyRecognition) => {
      // no-speech / aborted are benign; permission denials disarm cleanly.
      if (ev?.error === 'not-allowed' || ev?.error === 'service-not-allowed') {
        stopVoice();
        setVoiceSupported(false);
        setTrace({ kind: 'error', text: 'microphone permission blocked — text mode', id: Date.now() });
      }
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
          'group flex items-center gap-2.5 rounded-md border border-l-2 border-border bg-[#0A0A0A]',
          'px-3 py-2.5 transition-colors duration-150',
          'focus-within:border-emerald-500/50 focus-within:border-l-emerald-500',
          wakeGlow && 'border-amber-500/60 border-l-amber-500 animate-glow-pulse shadow-[0_0_12px_rgba(245,158,11,0.18)]'
        )}
      >
        {pending ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-emerald-500" />
        ) : (
          <span className={cn('select-none font-terminal text-sm font-bold leading-none', wakeGlow ? 'text-amber-500' : 'text-emerald-500')}>❯</span>
        )}

        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit(value);
          }}
          disabled={pending}
          placeholder={armed ? 'Say “Hey Hermes …” or type…' : 'Queue a task for the fleet…'}
          autoComplete="off"
          spellCheck={false}
          suppressHydrationWarning={true}
          className={cn(
            'flex-1 bg-transparent font-terminal text-xs text-foreground',
            'placeholder:text-muted-foreground/25 outline-none disabled:opacity-60'
          )}
        />

        {/* voice status anchor */}
        {voiceSupported && (
          <span
            className={cn(
              'select-none font-terminal text-[10px] tracking-[0.15em]',
              voiceState === 'listening' && 'text-amber-500/80',
              voiceState === 'processing' && 'text-neon-cyan/80',
              voiceState === 'idle' && 'text-muted-foreground/30'
            )}
          >
            {VOICE_LABEL[voiceState]}
          </span>
        )}

        {/* mic arm/disarm */}
        {voiceSupported && (
          <button
            onClick={() => (armed ? stopVoice() : startVoice())}
            suppressHydrationWarning={true}
            title={armed ? 'Disarm voice' : 'Arm “Hey Hermes” voice'}
            className={cn(
              'shrink-0 rounded p-0.5 transition-colors duration-100',
              armed ? 'text-amber-500 hover:text-amber-400' : 'text-muted-foreground/30 hover:text-muted-foreground/60'
            )}
          >
            {armed ? <MicOff className="size-3.5" /> : <Mic className="size-3.5" />}
          </button>
        )}

        {/* right-boundary tracking anchor */}
        <button
          onClick={() => void submit(value)}
          disabled={!value.trim() || pending}
          suppressHydrationWarning={true}
          className={cn(
            'shrink-0 select-none font-terminal text-[10px] tracking-[0.2em] transition-colors duration-100',
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
            {trace.kind === 'ok' ? '✓ ' : '✗ '}
            {trace.text}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

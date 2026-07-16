'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Mic, MicOff } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { speakBrowser } from '@/hooks/use-browser-speech';
import { useCoreFxStore } from '@/lib/fx/core-store';
import { CHAT_HISTORY_UPDATED_EVENT } from '@/lib/chat/events';
import type { ChatHistoryScope, ChatHistoryTurn } from '@/lib/chat/history';
import { cn } from '@/lib/utils';

type ClaudePersona = 'architect' | 'trading' | 'coding' | 'business_mentor' | 'life_mentor' | 'focus_mentor';
type VoiceState = 'idle' | 'arming' | 'listening' | 'processing' | 'unsupported' | 'blocked';

// Web Speech API is still vendor-prefixed in Chromium and absent in some TS DOM lib builds.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecognition = any;

const PRIMARY_WAKE_NAME = 'Nova';
const WAKE_NAMES = [
  'nova',
  'claude',
  'cloud',
  'clawed',
  'codex',
  'jarvis',
  'hermes',
];
const SILENCE_MS = 3800;
const FOLLOW_UP_MS = 18_000;
const AUTO_ARM_DELAY_MS = 1200;
const RESTART_AFTER_TTS_MS = 80;
const RESTART_AFTER_END_MS = 260;
const VOICE_PREF_KEY = 'maf:ambient-voice';

function readVoicePref() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(VOICE_PREF_KEY);
  } catch {
    return null;
  }
}

function writeVoicePref(value: 'on' | 'off') {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VOICE_PREF_KEY, value);
  } catch {
    // Storage can be blocked in hardened browser profiles; voice should still
    // work for the current session.
  }
}

function clearVoicePref() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(VOICE_PREF_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function getSpeechRecognitionCtor(): AnyRecognition | null {
  if (typeof window === 'undefined') return null;
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractWakeCommand(raw: string): string | null {
  const phrase = raw.replace(/\s+/g, ' ').trim();
  if (!phrase) return null;

  for (const name of WAKE_NAMES) {
    const re = new RegExp(`(?:^|\\b)(?:hey|ok|okay)?\\s*${escapeRegExp(name)}\\b[\\s,.:;!-]*(.*)$`, 'i');
    const match = phrase.match(re);
    if (match) return (match[1] ?? '').trim();
  }

  return null;
}

function normalizeSpeech(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function looksLikeAssistantEcho(heard: string, reply: string) {
  const heardNorm = normalizeSpeech(heard);
  const replyNorm = normalizeSpeech(reply);
  if (heardNorm.length < 10 || replyNorm.length < 10) return false;
  const head = heardNorm.slice(0, 60);
  const replyHead = replyNorm.slice(0, 60);
  return replyNorm.includes(head) || heardNorm.includes(replyHead);
}

function readRecognitionText(event: AnyRecognition) {
  let final = '';
  let interim = '';
  const start = typeof event.resultIndex === 'number' ? event.resultIndex : 0;
  for (let i = start; i < event.results.length; i++) {
    const text = event.results[i][0].transcript as string;
    if (event.results[i].isFinal) final += `${text} `;
    else interim += `${text} `;
  }
  return `${final}${interim}`.trim();
}

function voiceTarget(pathname: string): { scope: ChatHistoryScope; persona: ClaudePersona; label: string } {
  if (pathname.includes('/rooms/trading')) return { scope: 'trading', persona: 'trading', label: 'Trading' };
  if (pathname.includes('/rooms/coding')) return { scope: 'coding', persona: 'coding', label: 'Coding' };
  if (pathname.includes('/dashboard/personal')) return { scope: 'personal', persona: 'business_mentor', label: 'Personal' };
  return { scope: 'hub', persona: 'architect', label: 'Hub' };
}

export function GlobalVoiceControl({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  const target = useMemo(() => voiceTarget(pathname), [pathname]);
  const targetRef = useRef(target);
  const setCoreListening = useCoreFxStore((s) => s.setIsListening);

  const [supported, setSupported] = useState(false);
  const [armed, setArmed] = useState(false);
  const [state, setState] = useState<VoiceState>('idle');
  const [status, setStatus] = useState(`Say "${PRIMARY_WAKE_NAME}..." then your command`);
  const [heard, setHeard] = useState('');

  const recognitionRef = useRef<AnyRecognition>(null);
  const armedRef = useRef(false);
  const processingRef = useRef(false);
  const capturingRef = useRef(false);
  const commandBufferRef = useRef('');
  const silenceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recognitionActiveRef = useRef(false);
  const followUpUntilRef = useRef(0);
  const lastAssistantReplyRef = useRef('');

  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  const clearSilence = useCallback(() => {
    if (silenceRef.current) {
      clearTimeout(silenceRef.current);
      silenceRef.current = null;
    }
  }, []);

  const clearRestart = useCallback(() => {
    if (restartRef.current) {
      clearTimeout(restartRef.current);
      restartRef.current = null;
    }
  }, []);

  const resetCapture = useCallback(() => {
    clearSilence();
    capturingRef.current = false;
    commandBufferRef.current = '';
    setHeard('');
  }, [clearSilence]);

  const startRecognition = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition || !armedRef.current || processingRef.current) return;
    if (recognitionActiveRef.current) return;

    // Never open the mic while Nova is still speaking, or recognition captures
    // the TTS output instead of the operator. Reschedule until synthesis ends.
    if (typeof window !== 'undefined' && window.speechSynthesis?.speaking) {
      if (restartRef.current) clearTimeout(restartRef.current);
      restartRef.current = setTimeout(() => startRecognition(), 400);
      return;
    }

    try {
      recognition.start();
    } catch (err) {
      // start() throws if the browser still considers the previous session
      // active — surface it instead of wedging the voice loop silently.
      console.warn('[nova] recognition.start() threw', err);
      if (armedRef.current && !processingRef.current) {
        if (restartRef.current) clearTimeout(restartRef.current);
        restartRef.current = setTimeout(() => startRecognition(), 650);
      }
    }
  }, []);

  const restartRecognition = useCallback((delayMs = RESTART_AFTER_END_MS) => {
    clearRestart();
    restartRef.current = setTimeout(startRecognition, delayMs);
  }, [clearRestart, startRecognition]);

  const stopVoice = useCallback(() => {
    armedRef.current = false;
    setArmed(false);
    setState('idle');
    setStatus('Voice standby');
    setCoreListening(false);
    resetCapture();
    clearRestart();
    try {
      recognitionRef.current?.stop();
    } catch {
      // already stopped
    }
    recognitionActiveRef.current = false;
    clearVoicePref();
  }, [clearRestart, resetCapture, setCoreListening]);

  const submitAmbientCommand = useCallback(
    async (command: string) => {
      const prompt = command.trim();
      if (!prompt || processingRef.current) return;

      processingRef.current = true;
      setState('processing');
      setCoreListening(false);
      resetCapture();

      try {
        recognitionRef.current?.stop();
      } catch {
        // already stopped
      }

      const currentTarget = targetRef.current;
      setStatus(`Routing to ${currentTarget.label}...`);

      // Single resume owner. Runs exactly once per command — AFTER Nova finishes
      // speaking (success) or immediately (error). Clears processing, opens the
      // follow-up window from THIS moment (not before TTS), and re-arms the mic.
      let resumed = false;
      const resumeListening = () => {
        if (resumed) return;
        resumed = true;
        clearRestart();
        processingRef.current = false;
        if (!armedRef.current) {
          setState('idle');
          return;
        }
        followUpUntilRef.current = Date.now() + FOLLOW_UP_MS;
        setState('listening');
        setStatus(`Listening for follow-up in ${targetRef.current.label}`);
        restartRecognition(RESTART_AFTER_TTS_MS);
      };

      try {
        const res = await fetch('/api/converse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: prompt,
            scope: currentTarget.scope,
            persona: currentTarget.persona,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          reply?: string;
          error?: string;
          history?: ChatHistoryTurn[];
        };
        const reply = data.reply ?? data.error ?? 'I could not respond.';
        if (Array.isArray(data.history)) {
          window.dispatchEvent(
            new CustomEvent(CHAT_HISTORY_UPDATED_EVENT, {
              detail: { scope: currentTarget.scope, turns: data.history },
            }),
          );
        }
        window.dispatchEvent(new CustomEvent(CHAT_HISTORY_UPDATED_EVENT, { detail: { scope: currentTarget.scope } }));
        if (data.error) {
          setStatus(`Voice error: ${data.error.slice(0, 80)}`);
          resumeListening();
        } else {
          lastAssistantReplyRef.current = reply;
          setStatus(`Nova speaking, then listening in ${currentTarget.label}`);
          // Resume ONLY when speech finishes — never mid-utterance. onEnd fires
          // on natural end, synthesis error, or unavailable TTS, so the loop
          // always continues.
          speakBrowser(reply, { onEnd: resumeListening });
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'voice command failed';
        setStatus(reason);
        console.warn('[nova]', reason);
        resumeListening();
      }
    },
    [clearRestart, resetCapture, restartRecognition, setCoreListening],
  );

  const armSilenceDispatch = useCallback(() => {
    clearSilence();
    silenceRef.current = setTimeout(() => {
      const command = commandBufferRef.current.trim();
      resetCapture();
      if (command) void submitAmbientCommand(command);
      else setStatus('Wake word heard - no command captured');
    }, SILENCE_MS);
  }, [clearSilence, resetCapture, submitAmbientCommand]);

  const handlePhrase = useCallback(
    (phrase: string) => {
      if (processingRef.current) return;
      const cleaned = phrase.replace(/^[\s,.:;-]+/, '').trim();
      if (!cleaned) return;
      if (looksLikeAssistantEcho(cleaned, lastAssistantReplyRef.current)) return;

      const wakeCommand = extractWakeCommand(cleaned);
      const followUpOpen = Date.now() < followUpUntilRef.current;
      if (!capturingRef.current) {
        if (wakeCommand === null && !followUpOpen) return;
        capturingRef.current = true;
        const command = wakeCommand ?? cleaned;
        commandBufferRef.current = command;
        setHeard(command);
        setStatus(command ? 'Command heard - waiting for pause' : 'Wake word heard - listening');
        armSilenceDispatch();
        return;
      }

      const next = wakeCommand ?? cleaned;
      commandBufferRef.current = next;
      setHeard(next);
      setStatus('Command heard - waiting for pause');
      armSilenceDispatch();
    },
    [armSilenceDispatch],
  );

  const startVoice = useCallback(
    async (manual = true) => {
      const Ctor = getSpeechRecognitionCtor();
      if (!Ctor) {
        setState('unsupported');
        setStatus('Voice input is not supported in this browser');
        return;
      }

      setState('arming');
      setStatus(`Requesting microphone permission for ${PRIMARY_WAKE_NAME}...`);

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      } catch (err) {
        const name = err instanceof DOMException ? err.name : 'unknown';
        const blocked = name === 'NotAllowedError' && manual;
        setState(blocked ? 'blocked' : 'idle');
        setArmed(false);
        armedRef.current = false;
        setCoreListening(false);
        setStatus(
          name === 'NotAllowedError'
            ? blocked
              ? 'Mic blocked - allow microphone for this site, then arm voice'
              : `Click Nova once to allow ${PRIMARY_WAKE_NAME}`
            : name === 'NotFoundError'
              ? 'No microphone found'
              : `Mic unavailable (${name})`,
        );
        return;
      }

      if (!recognitionRef.current) {
        const recognition = new Ctor();
        recognition.lang = 'en-US';
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
          if (!armedRef.current) return;
          recognitionActiveRef.current = true;
          setState('listening');
          setStatus(
            Date.now() < followUpUntilRef.current
              ? `Listening for follow-up in ${targetRef.current.label}`
              : `Listening for ${PRIMARY_WAKE_NAME} in ${targetRef.current.label}`,
          );
          setCoreListening(true);
        };

        recognition.onresult = (event: AnyRecognition) => {
          handlePhrase(readRecognitionText(event));
        };

        recognition.onerror = (event: AnyRecognition) => {
          const code = event?.error as string | undefined;
          if (code === 'not-allowed' || code === 'service-not-allowed') {
            stopVoice();
            setState('blocked');
            setStatus('Mic blocked - allow microphone for this site, then arm voice');
            return;
          }
          if (code === 'network') setStatus('Speech service network hiccup - retrying');
        };

        recognition.onend = () => {
          recognitionActiveRef.current = false;
          setCoreListening(false);
          if (armedRef.current && !processingRef.current) restartRecognition(RESTART_AFTER_END_MS);
        };

        recognitionRef.current = recognition;
      }

      armedRef.current = true;
      setArmed(true);
      setState('listening');
      setStatus(`Listening for ${PRIMARY_WAKE_NAME} in ${targetRef.current.label}`);
      if (manual) writeVoicePref('on');
      startRecognition();
    },
    [handlePhrase, restartRecognition, setCoreListening, startRecognition, stopVoice],
  );

  useEffect(() => {
    if (!armedRef.current || processingRef.current) return;
    setStatus(
      Date.now() < followUpUntilRef.current
        ? `Listening for follow-up in ${target.label}`
        : `Listening for ${PRIMARY_WAKE_NAME} in ${target.label}`,
    );
  }, [target]);

  useEffect(() => {
    const ok = getSpeechRecognitionCtor() !== null && typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
    setSupported(ok);
    if (!ok) {
      setState('unsupported');
      setStatus('Voice input is not supported in this browser');
    }
  }, []);

  useEffect(() => {
    if (!supported) return;
    const t = window.setTimeout(() => {
      const pref = readVoicePref();
      if (pref === 'off') return;
      void startVoice(false);
    }, AUTO_ARM_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [startVoice, supported]);

  useEffect(() => {
    return () => {
      armedRef.current = false;
      setCoreListening(false);
      resetCapture();
      clearRestart();
      try {
        recognitionRef.current?.stop();
      } catch {
        // noop
      }
      recognitionActiveRef.current = false;
    };
  }, [clearRestart, resetCapture, setCoreListening]);

  const active = armed && state === 'listening';
  const arming = state === 'arming';
  const blocked = state === 'blocked' || state === 'unsupported';

  return (
    <div
      className={cn(
        'border border-border/80 bg-background/90 shadow-2xl shadow-background/30 backdrop-blur',
        compact
          ? 'w-auto rounded-md p-0.5'
          : 'w-[min(20rem,calc(100vw-5rem))] rounded-lg p-1.5',
      )}
    >
      <button
        type="button"
        onClick={() => (armed ? stopVoice() : void startVoice(true))}
        disabled={arming || (!supported && state === 'unsupported')}
        aria-pressed={armed}
        title={status}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md border px-2 font-terminal text-[10px] transition-colors',
          compact ? 'h-7' : 'h-8 gap-2',
          compact && 'border-border bg-surface-1/90 text-muted-foreground hover:text-foreground',
          !compact && active && 'border-amber-400/45 bg-amber-400/10 text-amber-300 shadow-[0_0_18px_rgba(251,191,36,0.16)]',
          !compact && (state === 'processing' || arming) && 'border-primary/45 bg-primary/10 text-primary',
          !compact && !active && state !== 'processing' && !arming && 'border-border bg-surface-1/90 text-muted-foreground hover:text-foreground',
          blocked && 'border-neon-red/35 text-neon-red/80',
        )}
      >
        {state === 'processing' || arming ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
        ) : armed ? (
          <Mic className="size-3.5 shrink-0" aria-hidden />
        ) : (
          <MicOff className="size-3.5 shrink-0" aria-hidden />
        )}
        <span className="flex min-w-0 flex-1 items-center gap-1">
          <span className="shrink-0">NOVA</span>
          {!compact && (
            <span className="truncate text-muted-foreground/70">
              {heard ? `"${heard.slice(0, 34)}${heard.length > 34 ? '...' : ''}"` : target.label}
            </span>
          )}
        </span>
      </button>
      {compact ? (
        <span aria-live="polite" className="sr-only">{status}</span>
      ) : (
        <p aria-live="polite" className="mt-1 truncate px-1 font-terminal text-[9px] text-muted-foreground/60">
          {status}
        </p>
      )}
    </div>
  );
}

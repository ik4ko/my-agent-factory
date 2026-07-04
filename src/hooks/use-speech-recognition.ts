'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export type SpeechState = 'idle' | 'listening' | 'processing' | 'unsupported';

interface UseSpeechRecognitionReturn {
  state: SpeechState;
  transcript: string;
  start: () => void;
  stop: () => void;
  reset: () => void;
  isSupported: boolean;
}

// Web Speech API — not yet in all TS lib.dom.d.ts versions; use loose typing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecognition = any;

function getSpeechRecognition(): AnyRecognition | null {
  // Strict runtime guard: eliminates any server/client divergence and never
  // touches window properties that don't exist.
  if (typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
  }
  return null;
}

export function useSpeechRecognition(
  onFinal: (transcript: string) => void
): UseSpeechRecognitionReturn {
  const [state, setState] = useState<SpeechState>('idle');
  const [transcript, setTranscript] = useState('');
  const recogRef = useRef<AnyRecognition>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  // isSupported is STATE set post-mount, never computed during render:
  // SSR and the client's first paint both render the unsupported branch,
  // so hydration sees identical markup.
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    // Detection only — the engine is NOT constructed here. Construction and
    // any permission prompt are deferred to start(), which callers invoke
    // from a user gesture, satisfying browser autoplay/mic policies on hard
    // reloads.
    if (getSpeechRecognition() !== null) setIsSupported(true);
    else setState('unsupported');

    return () => {
      try {
        recogRef.current?.abort();
      } catch {
        /* already torn down */
      }
      recogRef.current = null;
    };
  }, []);

  /** Lazily construct the engine — first called inside a user gesture. */
  const ensureEngine = useCallback((): AnyRecognition | null => {
    if (recogRef.current) return recogRef.current;
    const SRClass = getSpeechRecognition();
    if (!SRClass) {
      setState('unsupported');
      return null;
    }
    const recog = new SRClass();
    recog.lang = 'en-US';
    recog.continuous = false;
    recog.interimResults = true;
    recog.maxAlternatives = 1;

    recog.onstart = () => setState('listening');

    recog.onresult = (e: AnyRecognition) => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript as string;
        if (e.results[i].isFinal) final += text;
        else interim += text;
      }
      setTranscript(final || interim);
      if (final) {
        setState('processing');
        onFinalRef.current(final.trim());
      }
    };

    recog.onerror = () => setState('idle');
    recog.onend = () =>
      setState((s: SpeechState) => (s === 'listening' ? 'idle' : s));

    recogRef.current = recog;
    return recog;
  }, []);

  const start = useCallback(() => {
    if (state === 'listening') return;
    const recog = ensureEngine();
    if (!recog) return;
    setTranscript('');
    setState('listening');
    try {
      recog.start();
    } catch {
      /* start() throws if called while already started — benign */
    }
  }, [state, ensureEngine]);

  const stop = useCallback(() => {
    recogRef.current?.stop();
    setState('idle');
  }, []);

  const reset = useCallback(() => {
    setTranscript('');
    setState((s: SpeechState) => (s !== 'unsupported' ? 'idle' : s));
  }, []);

  return { state, transcript, start, stop, reset, isSupported };
}

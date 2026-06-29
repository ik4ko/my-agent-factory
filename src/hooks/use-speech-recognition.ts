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
  if (typeof window === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeechRecognition(
  onFinal: (transcript: string) => void
): UseSpeechRecognitionReturn {
  const [state, setState] = useState<SpeechState>('idle');
  const [transcript, setTranscript] = useState('');
  const recogRef = useRef<AnyRecognition>(null);

  const isSupported = getSpeechRecognition() !== null;

  useEffect(() => {
    const SRClass = getSpeechRecognition();
    if (!SRClass) {
      setState('unsupported');
      return;
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
        onFinal(final.trim());
      }
    };

    recog.onerror = () => setState('idle');
    recog.onend = () =>
      setState((s: SpeechState) => (s === 'listening' ? 'idle' : s));

    recogRef.current = recog;
    return () => { recog.abort(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(() => {
    if (!recogRef.current || state === 'listening') return;
    setTranscript('');
    setState('listening');
    recogRef.current.start();
  }, [state]);

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

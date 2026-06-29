'use client';

import { useCallback, useEffect, useRef } from 'react';

interface TTSOptions {
  rate?: number;   // 0.5 – 2.0, default 1.0
  pitch?: number;  // 0 – 2, default 1
  volume?: number; // 0 – 1, default 1
  voice?: string;  // voice name substring to prefer (e.g. "Google UK")
}

export function useTTS() {
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const preferredVoiceRef = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    synthRef.current = window.speechSynthesis;

    const pickVoice = () => {
      const voices = synthRef.current!.getVoices();
      // Prefer a deep, robotic-sounding English voice for the cyberpunk feel
      const preferred = voices.find(
        (v) => v.lang.startsWith('en') && /google|microsoft|samantha|alex/i.test(v.name)
      ) ?? voices.find((v) => v.lang.startsWith('en')) ?? voices[0] ?? null;
      preferredVoiceRef.current = preferred;
    };

    pickVoice();
    synthRef.current.addEventListener('voiceschanged', pickVoice);
    return () => synthRef.current?.removeEventListener('voiceschanged', pickVoice);
  }, []);

  const speak = useCallback((text: string, opts: TTSOptions = {}) => {
    const synth = synthRef.current;
    if (!synth) return;
    synth.cancel();

    const utt = new SpeechSynthesisUtterance(text);
    if (preferredVoiceRef.current) utt.voice = preferredVoiceRef.current;
    utt.rate   = opts.rate   ?? 1.0;
    utt.pitch  = opts.pitch  ?? 0.8; // slightly lower for a mission-control feel
    utt.volume = opts.volume ?? 0.9;
    synth.speak(utt);
  }, []);

  const stop = useCallback(() => {
    synthRef.current?.cancel();
  }, []);

  const isSupported =
    typeof window !== 'undefined' && 'speechSynthesis' in window;

  return { speak, stop, isSupported };
}

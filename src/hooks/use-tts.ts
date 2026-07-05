'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface TTSOptions {
  rate?: number;   // 0.5 – 2.0, default 1.0
  pitch?: number;  // 0 – 2, default 1
  volume?: number; // 0 – 1, default 1
  voice?: string;  // voice name substring to prefer (e.g. "Google UK")
}

export function useTTS() {
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const preferredVoiceRef = useRef<SpeechSynthesisVoice | null>(null);

  // Hydration parity: isSupported is STATE set post-mount, never computed
  // from `window` during render. Server HTML and the client's first paint
  // both render the unsupported branch; the capability flips in an effect.
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    setIsSupported(true);
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

  // Chrome heartbeat: Chrome's native speech engine silently kills
  // utterances after ~15s (notoriously with remote voices). Two defenses:
  //  1. Long text is split into sentence-sized utterances and queued —
  //     short utterances rarely trip the killer at all.
  //  2. While speaking, a pause()/resume() nudge every 10s resets Chrome's
  //     internal watchdog for whatever utterance is in flight.
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const speak = useCallback((text: string, opts: TTSOptions = {}) => {
    const synth = synthRef.current;
    if (!synth) return;
    synth.cancel();
    clearHeartbeat();

    // Sentence-boundary chunking, ~220-char ceiling per utterance.
    const chunks: string[] = [];
    let current = '';
    for (const part of text.split(/(?<=[.!?…])\s+/)) {
      if (current && current.length + part.length + 1 > 220) {
        chunks.push(current);
        current = part;
      } else {
        current = current ? `${current} ${part}` : part;
      }
    }
    if (current) chunks.push(current);

    for (const chunk of chunks) {
      const utt = new SpeechSynthesisUtterance(chunk);
      if (preferredVoiceRef.current) utt.voice = preferredVoiceRef.current;
      utt.rate   = opts.rate   ?? 1.0;
      utt.pitch  = opts.pitch  ?? 0.8; // slightly lower for a mission-control feel
      utt.volume = opts.volume ?? 0.9;
      synth.speak(utt); // queued — plays sequentially
    }

    heartbeatRef.current = setInterval(() => {
      const s = synthRef.current;
      if (!s || !s.speaking) {
        clearHeartbeat(); // queue drained — never leave a live timer behind
        return;
      }
      s.pause();
      s.resume();
    }, 10_000);
  }, [clearHeartbeat]);

  const stop = useCallback(() => {
    clearHeartbeat();
    synthRef.current?.cancel();
  }, [clearHeartbeat]);

  // Unmount hygiene: kill the heartbeat and any in-flight speech.
  useEffect(() => {
    return () => {
      clearHeartbeat();
      synthRef.current?.cancel();
    };
  }, [clearHeartbeat]);

  return { speak, stop, isSupported };
}

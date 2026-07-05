'use client';

import { useCallback, useRef, useState } from 'react';

export interface ConverseTurn { role: 'user' | 'assistant'; content: string; }
export interface ConverseResult {
  reply: string;
  preamble?: string;
  delegations?: { agent: string; task: string; provider: string; model: string }[];
  brain?: { name: string; provider: string; model: string };
  error?: string;
}

/** Speaks text via the browser's built-in TTS (free, no keys). SSR-safe. */
export function speakBrowser(text: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    u.pitch = 1;
    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find((v) => /en-US/i.test(v.lang) && /(google|natural|aria|jenny)/i.test(v.name)) ??
      voices.find((v) => v.lang.startsWith('en')) ??
      voices[0];
    if (preferred) u.voice = preferred;
    window.speechSynthesis.speak(u);
  } catch {
    /* speech synthesis unavailable — silent */
  }
}

/**
 * Client hook for the Claude-CEO conversation loop. Posts to /api/converse,
 * keeps a short rolling history, and speaks Claude's reply out loud.
 */
export function useConverse() {
  const [history, setHistory] = useState<ConverseTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [lastReply, setLastReply] = useState<string | null>(null);
  const historyRef = useRef<ConverseTurn[]>([]);
  historyRef.current = history;

  const send = useCallback(async (message: string, opts?: { speak?: boolean }): Promise<ConverseResult | null> => {
    const msg = message.trim();
    if (!msg) return null;
    setBusy(true);
    setHistory((h) => [...h, { role: 'user', content: msg }]);
    try {
      const res = await fetch('/api/converse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, history: historyRef.current.slice(-8) }),
      });
      const data = (await res.json().catch(() => ({}))) as ConverseResult;
      const reply = data.reply || data.error || 'Sorry, I could not respond.';
      setHistory((h) => [...h, { role: 'assistant', content: reply }]);
      setLastReply(reply);
      if (opts?.speak !== false) speakBrowser(reply);
      return data;
    } catch (e) {
      const reply = `Network error: ${e instanceof Error ? e.message : 'unreachable'}`;
      setHistory((h) => [...h, { role: 'assistant', content: reply }]);
      setLastReply(reply);
      return { reply, error: reply };
    } finally {
      setBusy(false);
    }
  }, []);

  return { history, busy, lastReply, send, speak: speakBrowser };
}

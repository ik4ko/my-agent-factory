'use client';

import { create } from 'zustand';

export interface ConverseTurn {
  role: 'user' | 'assistant';
  content: string;
  /** True while this turn is a live, still-being-spoken STT partial — not yet
   *  a submitted message. Replaced in place as more chunks arrive, and
   *  cleared (superseded by the final turn) once the utterance finalizes. */
  interim?: boolean;
}
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

interface ConverseState {
  history: ConverseTurn[];
  busy: boolean;
  lastReply: string | null;
  setInterim: (text: string) => void;
  send: (message: string, opts?: { speak?: boolean }) => Promise<ConverseResult | null>;
}

// A shared store, not per-component state: TaskInput's voice pipeline and
// every AgentChat instance (main deck pane, ambient overlay, Personal Room)
// must observe the SAME conversation — otherwise a voice-dispatched message
// updates a `history` array nothing on screen ever reads.
const useConverseStore = create<ConverseState>((set, get) => ({
  history: [],
  busy: false,
  lastReply: null,

  setInterim: (text) => {
    const trimmed = text.trim();
    const settled = get().history.filter((t) => !t.interim);
    set({ history: trimmed ? [...settled, { role: 'user', content: trimmed, interim: true }] : settled });
  },

  send: async (message, opts) => {
    const msg = message.trim();
    if (!msg) return null;
    set({ busy: true });
    // Clears any live interim partial for this same utterance and appends
    // the settled turn in one update, so the UI never shows a duplicate.
    set((s) => ({ history: [...s.history.filter((t) => !t.interim), { role: 'user', content: msg }] }));
    try {
      const res = await fetch('/api/converse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, history: get().history.slice(-9, -1) }),
      });
      const data = (await res.json().catch(() => ({}))) as ConverseResult;
      const reply = data.reply || data.error || 'Sorry, I could not respond.';
      set((s) => ({ history: [...s.history, { role: 'assistant', content: reply }], lastReply: reply }));
      if (opts?.speak !== false) speakBrowser(reply);
      return data;
    } catch (e) {
      const reply = `Network error: ${e instanceof Error ? e.message : 'unreachable'}`;
      set((s) => ({ history: [...s.history, { role: 'assistant', content: reply }], lastReply: reply }));
      return { reply, error: reply };
    } finally {
      set({ busy: false });
    }
  },
}));

/**
 * Client hook for the Claude-CEO conversation loop. Posts to /api/converse,
 * keeps a short rolling history shared across every consumer (chat panels
 * and the voice dock alike), and speaks Claude's reply out loud.
 */
export function useConverse() {
  const history = useConverseStore((s) => s.history);
  const busy = useConverseStore((s) => s.busy);
  const lastReply = useConverseStore((s) => s.lastReply);
  const setInterim = useConverseStore((s) => s.setInterim);
  const send = useConverseStore((s) => s.send);
  return { history, busy, lastReply, setInterim, send, speak: speakBrowser };
}

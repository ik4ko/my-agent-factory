'use client';

export interface SpeakOptions {
  /** Fires exactly once when speech is done — on natural end, on a synthesis
   *  error, or immediately when TTS is unavailable/empty. Callers use it to
   *  resume mic capture ONLY after Nova has finished talking, so recognition
   *  never captures the TTS output as if it were the operator. */
  onEnd?: () => void;
}

/** Speaks text via the browser's built-in TTS (free, no keys). SSR-safe.
 *  Backward compatible: `speakBrowser(text)` behaves exactly as before; pass
 *  `{ onEnd }` to be notified the moment speech completes. */
export function speakBrowser(text: string, opts?: SpeakOptions) {
  const onEnd = opts?.onEnd;
  let settled = false;
  let watchdog: number | undefined;
  const finish = () => {
    if (settled) return;
    settled = true;
    if (watchdog) window.clearTimeout(watchdog);
    onEnd?.();
  };

  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) {
    finish();
    return;
  }
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.02;
    utterance.pitch = 1;
    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find((voice) => /en-US/i.test(voice.lang) && /(google|natural|aria|jenny)/i.test(voice.name)) ??
      voices.find((voice) => voice.lang.startsWith('en')) ??
      voices[0];
    if (preferred) utterance.voice = preferred;
    utterance.onend = finish;
    utterance.onerror = finish;
    watchdog = window.setTimeout(finish, Math.min(18_000, Math.max(2500, text.length * 85)));
    window.speechSynthesis.speak(utterance);
  } catch {
    /* speech synthesis unavailable — resume listening anyway */
    finish();
  }
}

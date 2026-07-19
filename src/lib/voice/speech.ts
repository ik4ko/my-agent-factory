/**
 * Pure speech-text helpers for the ambient voice loop (Nova).
 * Extracted from global-voice-control.tsx so the load-bearing logic —
 * wake-word extraction and TTS echo suppression — is unit-testable
 * (see __tests__/speech.test.ts); the mic loop itself cannot run in CI.
 */

export const PRIMARY_WAKE_NAME = 'Nova';

/** Wake words, including common speech-recognition mishearings of them. */
export const WAKE_NAMES = [
  'nova',
  'claude',
  'cloud',
  'clawed',
  'codex',
  'jarvis',
  'hermes',
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Returns the command following a wake word, '' if the wake word ended the
 *  phrase, or null if no wake word was heard. */
export function extractWakeCommand(raw: string): string | null {
  const phrase = raw.replace(/\s+/g, ' ').trim();
  if (!phrase) return null;

  for (const name of WAKE_NAMES) {
    const re = new RegExp(`(?:^|\\b)(?:hey|ok|okay)?\\s*${escapeRegExp(name)}\\b[\\s,.:;!-]*(.*)$`, 'i');
    const match = phrase.match(re);
    if (match) return (match[1] ?? '').trim();
  }

  return null;
}

export function normalizeSpeech(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** True when the recognizer most likely captured Nova's own TTS output
 *  rather than the operator (open-mic echo). */
export function looksLikeAssistantEcho(heard: string, reply: string): boolean {
  const heardNorm = normalizeSpeech(heard);
  const replyNorm = normalizeSpeech(reply);
  if (heardNorm.length < 10 || replyNorm.length < 10) return false;
  const head = heardNorm.slice(0, 60);
  const replyHead = replyNorm.slice(0, 60);
  return replyNorm.includes(head) || heardNorm.includes(replyHead);
}

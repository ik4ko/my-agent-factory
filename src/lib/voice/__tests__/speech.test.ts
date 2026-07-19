import { extractWakeCommand, looksLikeAssistantEcho, normalizeSpeech } from '../speech';

describe('normalizeSpeech', () => {
  it('lowercases, strips punctuation, and collapses whitespace', () => {
    expect(normalizeSpeech("  Hey, NOVA!  What's   up? ")).toBe('hey nova what s up');
    expect(normalizeSpeech('')).toBe('');
  });
});

describe('extractWakeCommand', () => {
  it('extracts the command after each wake word', () => {
    expect(extractWakeCommand('Nova what is my schedule')).toBe('what is my schedule');
    expect(extractWakeCommand('hey nova, check the market')).toBe('check the market');
    expect(extractWakeCommand('okay jarvis run the report')).toBe('run the report');
  });

  it('handles recognizer mishearings of the wake word', () => {
    expect(extractWakeCommand('cloud check my tasks')).toBe('check my tasks');
    expect(extractWakeCommand('clawed what changed today')).toBe('what changed today');
  });

  it('strips separator punctuation after the wake word', () => {
    expect(extractWakeCommand('nova: status')).toBe('status');
    expect(extractWakeCommand('nova - status')).toBe('status');
  });

  it('returns empty string for a bare wake word (wake, no command yet)', () => {
    expect(extractWakeCommand('nova')).toBe('');
    expect(extractWakeCommand('hey nova')).toBe('');
  });

  it('returns null when no wake word is present', () => {
    expect(extractWakeCommand('what is the weather')).toBeNull();
    expect(extractWakeCommand('')).toBeNull();
    // Wake word must be a whole word — "supernova" must not wake the mic.
    expect(extractWakeCommand('that supernova was bright')).toBeNull();
  });

  it('matches a wake word mid-phrase', () => {
    expect(extractWakeCommand('um nova please check email')).toBe('please check email');
  });
});

describe('looksLikeAssistantEcho', () => {
  const reply = 'The market is quiet today; NVDA is holding steady near its highs.';

  it('flags the mic re-capturing the start of the TTS reply', () => {
    expect(looksLikeAssistantEcho('the market is quiet today nvda is holding', reply)).toBe(true);
  });

  it('flags when heard text contains the reply head (echo with noise)', () => {
    expect(looksLikeAssistantEcho(`uh ${reply}`, reply)).toBe(true);
  });

  it('does not flag a genuine operator follow-up', () => {
    expect(looksLikeAssistantEcho('what about AMD instead of NVDA', reply)).toBe(false);
  });

  it('never flags short utterances (too little signal to compare)', () => {
    expect(looksLikeAssistantEcho('yes', reply)).toBe(false);
    expect(looksLikeAssistantEcho('the market', 'the mark')).toBe(false);
  });
});

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Terminal, Loader2, ChevronRight, Mic, MicOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSpeechRecognition } from '@/hooks/use-speech-recognition';
import type { HermesResult } from '@/lib/hermes/types';

const STATUS_COLOR: Record<HermesResult['status'], string> = {
  dispatched: 'text-neon-green',
  no_agents:  'text-neon-orange',
  error:      'text-neon-red',
};

export function HermesInput() {
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<HermesResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-clear result after 6 s
  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => setResult(null), 6000);
    return () => clearTimeout(t);
  }, [result]);

  const submitCommand = useCallback(async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setValue('');
    try {
      const res = await fetch('/api/hermes/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: trimmed }),
      });
      const data = (await res.json()) as HermesResult;
      setResult(data);
    } catch {
      setResult({
        requestId: '',
        status: 'error',
        intent: { agentType: 'generic', priority: 5, description: trimmed, confidence: 'llm' },
        message: 'Network error — Hermes unreachable.',
      });
    } finally {
      setPending(false);
      speechReset();
      inputRef.current?.focus();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const { state: voiceState, transcript, start: startVoice, stop: stopVoice, reset: speechReset, isSupported } =
    useSpeechRecognition(submitCommand);

  // Mirror live transcript into the input box
  useEffect(() => {
    if (voiceState === 'listening' && transcript) {
      setValue(transcript);
    }
  }, [transcript, voiceState]);

  const isListening = voiceState === 'listening';

  return (
    <div className="shrink-0 border-t border-border px-4 py-2 space-y-1">
      {/* Input bar */}
      <div
        className={cn(
          'flex items-center gap-2 rounded-md border px-3 py-2',
          'bg-surface-1 transition-colors duration-150',
          isListening
            ? 'border-neon-red/60 shadow-[0_0_8px_rgba(255,50,50,0.15)]'
            : pending
              ? 'border-primary/50'
              : 'border-border hover:border-border/60 focus-within:border-primary/60'
        )}
      >
        {/* Status icon */}
        {pending ? (
          <Loader2 className="size-3.5 text-primary animate-spin shrink-0" />
        ) : (
          <Terminal className="size-3.5 text-muted-foreground/30 shrink-0" />
        )}

        {/* Text input */}
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submitCommand(value); }}
          suppressHydrationWarning={true}
          disabled={pending || isListening}
          placeholder={isListening ? 'Listening…' : 'Issue command to Hermes…'}
          autoComplete="off"
          spellCheck={false}
          className={cn(
            'flex-1 bg-transparent font-terminal text-xs text-foreground',
            'placeholder:text-muted-foreground/20 outline-none',
            'disabled:opacity-60',
            isListening && 'placeholder:text-neon-red/40'
          )}
        />

        {/* Mic button */}
        {isSupported && (
          <button
            onClick={() => (isListening ? stopVoice() : startVoice())}
            disabled={pending}
            title={isListening ? 'Stop listening' : 'Voice command (hold or click)'}
            className={cn(
              'shrink-0 transition-colors duration-100 p-0.5 rounded',
              isListening
                ? 'text-neon-red animate-pulse'
                : 'text-muted-foreground/30 hover:text-muted-foreground/60',
              pending && 'opacity-20 cursor-not-allowed'
            )}
          >
            {isListening ? <MicOff className="size-3.5" /> : <Mic className="size-3.5" />}
          </button>
        )}

        {/* Send button */}
        <button
          onClick={() => void submitCommand(value)}
          disabled={!value.trim() || pending || isListening}
          className={cn(
            'flex items-center gap-0.5 font-terminal text-[10px] transition-colors duration-100 select-none',
            value.trim() && !pending && !isListening
              ? 'text-primary hover:text-primary/70'
              : 'text-muted-foreground/20 cursor-not-allowed'
          )}
        >
          <ChevronRight className="size-3" />
          SEND
        </button>
      </div>

      {/* Voice listening indicator */}
      <AnimatePresence>
        {isListening && (
          <motion.div
            key="voice-indicator"
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="flex items-center gap-1.5 px-1"
          >
            <span className="font-terminal text-[10px] text-neon-red animate-pulse">● REC</span>
            <span className="font-terminal text-[10px] text-muted-foreground/30">
              {transcript ? `"${transcript.slice(0, 60)}${transcript.length > 60 ? '…' : ''}"` : 'Speak your command…'}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Status / result line */}
      <AnimatePresence>
        {result && !isListening && (
          <motion.p
            key={result.requestId || result.message}
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.3 } }}
            transition={{ duration: 0.12 }}
            className={cn('font-terminal text-[10px] px-1', STATUS_COLOR[result.status])}
          >
            {result.status === 'dispatched' && '✓ '}
            {result.status === 'error' && '✗ '}
            {result.status === 'no_agents' && '⚠ '}
            {result.message}
            {result.intent && (
              <span className="ml-2 opacity-40">
                [{result.intent.agentType} · p{result.intent.priority} · {result.intent.confidence}]
              </span>
            )}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

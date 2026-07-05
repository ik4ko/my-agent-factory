'use client';

import { useEffect, useRef, useState } from 'react';
import { Send, Volume2, VolumeX, Bot, User } from 'lucide-react';
import { useConverse } from '@/hooks/use-converse';
import { cn } from '@/lib/utils';

/**
 * /dashboard/chat — type OR talk to Claude (the CEO brain). Full visible
 * transcript, so you can see and copy everything Claude and the helpers say.
 * Replies are spoken via the browser TTS when the speaker toggle is on.
 */
export default function ChatPage() {
  const { history, busy, send } = useConverse();
  const [value, setValue] = useState('');
  const [speakOn, setSpeakOn] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [history, busy]);

  const submit = async () => {
    const msg = value.trim();
    if (!msg || busy) return;
    setValue('');
    await send(msg, { speak: speakOn });
    inputRef.current?.focus();
  };

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-primary" />
          <span className="font-display text-sm font-semibold tracking-wide text-foreground/90">Chat</span>
          <span className="hidden text-[10px] uppercase tracking-widest text-muted-foreground sm:block">
            — Claude, CEO
          </span>
        </div>
        <button
          onClick={() => setSpeakOn((s) => !s)}
          title={speakOn ? 'Replies are spoken aloud' : 'Replies are text-only'}
          className={cn(
            'flex items-center gap-1.5 rounded-md border px-2 py-1 font-terminal text-[10px] transition-colors',
            speakOn ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
          )}
        >
          {speakOn ? <Volume2 className="size-3" /> : <VolumeX className="size-3" />}
          {speakOn ? 'SPEAKING' : 'TEXT ONLY'}
        </button>
      </header>

      {/* transcript */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {history.length === 0 && (
          <div className="mt-10 text-center text-xs text-muted-foreground/50">
            Type below to talk to Claude. Try: <span className="text-foreground/70">&quot;what&apos;s the fleet status?&quot;</span>{' '}
            or <span className="text-foreground/70">&quot;email someone@example.com that the matrix is live&quot;</span>.
          </div>
        )}
        {history.map((turn, i) => {
          const isUser = turn.role === 'user';
          return (
            <div key={i} className={cn('flex gap-2.5', isUser ? 'justify-end' : 'justify-start')}>
              {!isUser && (
                <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10">
                  <Bot className="size-3 text-primary" />
                </div>
              )}
              <div
                className={cn(
                  'max-w-[75%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-xs leading-relaxed',
                  isUser
                    ? 'bg-surface-3 text-foreground'
                    : 'border border-border bg-surface-1 text-foreground/90',
                )}
              >
                {turn.content}
              </div>
              {isUser && (
                <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2">
                  <User className="size-3 text-muted-foreground" />
                </div>
              )}
            </div>
          );
        })}
        {busy && (
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
            <span className="size-1.5 animate-pulse rounded-full bg-primary" /> Claude is thinking…
          </div>
        )}
      </div>

      {/* input */}
      <div className="shrink-0 border-t border-border bg-[#0A0A0A] px-4 py-3">
        <div className="flex items-end gap-2 rounded-md border border-l-2 border-border bg-[#0A0A0A] px-3 py-2 focus-within:border-emerald-500/50 focus-within:border-l-emerald-500">
          <textarea
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            rows={1}
            placeholder="Message Claude…  (Enter to send, Shift+Enter for newline)"
            autoComplete="off"
            spellCheck={false}
            suppressHydrationWarning
            className="max-h-32 flex-1 resize-none bg-transparent font-terminal text-xs text-foreground placeholder:text-muted-foreground/25 outline-none"
          />
          <button
            onClick={() => void submit()}
            disabled={!value.trim() || busy}
            className={cn(
              'flex items-center gap-1 rounded font-terminal text-[10px] tracking-wider transition-colors',
              value.trim() && !busy ? 'text-emerald-500 hover:text-emerald-400' : 'text-muted-foreground/25 cursor-not-allowed',
            )}
          >
            <Send className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

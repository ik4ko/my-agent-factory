'use client';

import { useState } from 'react';
import { Send, Radio } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useOutboundMessagesQuery } from '@/hooks/use-outbound-messages-query';

interface Turn {
  who: 'you' | 'system';
  text: string;
}

const QUICK_COMMANDS = ['status', 'pnl', 'positions', 'loops', 'help'];

function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

/** In-dashboard SMS simulator — drives the real command core
 *  (parseCommand/runCommand) with no phone required. Everything typed here
 *  hits the identical services Twilio will hit once configured. */
export function CommsSimulatorClient() {
  const [text, setText] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const { data: messages = [] } = useOutboundMessagesQuery();

  async function send(cmdText: string) {
    const trimmed = cmdText.trim();
    if (!trimmed || busy) return;
    setTurns((t) => [...t, { who: 'you', text: trimmed }]);
    setText('');
    setBusy(true);
    try {
      const res = await fetch('/api/comms/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed }),
      });
      const json = await res.json();
      setTurns((t) => [...t, { who: 'system', text: json.reply ?? json.error ?? `HTTP ${res.status}` }]);
    } catch (e) {
      setTurns((t) => [...t, { who: 'system', text: e instanceof Error ? e.message : 'request failed' }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <section className="flex flex-col gap-2">
        <h2 className="font-terminal text-xs uppercase tracking-widest text-muted-foreground">SMS simulator</h2>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_COMMANDS.map((c) => (
            <Button key={c} variant="outline" size="sm" onClick={() => send(c)} disabled={busy}>
              {c}
            </Button>
          ))}
        </div>

        <div className="flex min-h-[280px] flex-col gap-2 rounded-md border border-border bg-surface-2 p-3">
          {turns.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Type a command below — try <code className="font-terminal">status</code>, <code className="font-terminal">loops</code>, or{' '}
              <code className="font-terminal">new &lt;PIN&gt; watch NVDA for momentum</code>.
            </p>
          )}
          {turns.map((t, i) => (
            <div key={i} className={t.who === 'you' ? 'self-end text-right' : 'self-start text-left'}>
              <div
                className={
                  t.who === 'you'
                    ? 'inline-block rounded-lg bg-primary/15 px-3 py-1.5 text-xs text-foreground'
                    : 'inline-block rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground'
                }
              >
                {t.text}
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send(text)}
            placeholder="status / arm <PIN> / new <PIN> <objective> …"
            className="h-11 flex-1 rounded-md border border-border bg-background px-3 text-sm"
          />
          <Button onClick={() => send(text)} disabled={busy || !text.trim()} className="min-h-11">
            <Send />
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="flex items-center gap-1.5 font-terminal text-xs uppercase tracking-widest text-muted-foreground">
          <Radio className="size-3" /> Notification feed (live)
        </h2>
        <div className="flex flex-col gap-1.5">
          {messages.length === 0 && <p className="text-xs text-muted-foreground">No notifications yet.</p>}
          {messages.map((m) => (
            <div key={m.id} className="rounded-md border border-border p-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium">{m.channel} → {m.recipient}</span>
                <Badge variant={m.status === 'sent' || m.status === 'local' ? 'success' : m.status === 'failed' ? 'error' : 'muted'}>
                  {m.status}
                </Badge>
              </div>
              <p className="mt-1 text-foreground/90">{m.body}</p>
              <p className="mt-1 text-[10px] text-muted-foreground/60">{relativeTime(m.created_at)}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

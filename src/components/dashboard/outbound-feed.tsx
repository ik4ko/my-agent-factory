'use client';

import { useOutboundMessagesQuery } from '@/hooks/use-outbound-messages-query';
import { StatusDot } from '@/components/deck';
import { cn } from '@/lib/utils';

/**
 * Outbound comms feed (Personal Room) — every notification the system has
 * sent, live via the outbound_messages realtime hook. A SENT LOG, presented
 * honestly as such: rows are records of dispatched sends, not approvables.
 */
export function OutboundFeed() {
  const { data: messages = [], isLoading } = useOutboundMessagesQuery();

  if (isLoading) return <div className="h-24 animate-pulse rounded bg-surface-2/40" />;
  if (messages.length === 0) {
    return (
      <p className="p-3 text-center font-mono text-[10px] leading-relaxed text-ink-low">
        No outbound messages yet — the assistant's sends land here in real time.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {messages.map((m) => {
        const failed = Boolean(m.error) || m.status === 'FAILED';
        return (
          <div
            key={m.id}
            className="flex flex-col gap-[3px] rounded-[5px] border border-border/40 bg-white/[0.012] px-2.5 py-2"
          >
            <div className="flex items-center gap-2">
              <StatusDot status={failed ? 'error' : m.sent_at ? 'profit' : 'queued'} size={5} />
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-mid">
                {m.channel}
              </span>
              <span className="min-w-0 truncate font-mono text-[9px] text-primary-bright">{m.recipient}</span>
              <span className="ml-auto shrink-0 font-mono text-[8px] tabular text-ink-low">
                {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <span className={cn('truncate font-mono text-[9px]', failed ? 'text-destructive' : 'text-ink-mid')}>
              {failed ? (m.error ?? 'send failed') : (m.subject ?? m.body)}
            </span>
            {m.agent && <span className="font-mono text-[8px] text-ink-low">via {m.agent}</span>}
          </div>
        );
      })}
    </div>
  );
}

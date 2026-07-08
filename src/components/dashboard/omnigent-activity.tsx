'use client';

import { useQuery } from '@tanstack/react-query';
import { Radio } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OmnigentSessionSummary {
  id: string;
  agent_name: string | null;
  status: string;
  created_at: number;
}
interface OmnigentItem {
  id: string;
  type: string;
  role?: string;
  content?: { type: string; text: string }[];
}
interface ActivityResponse {
  reachable: boolean;
  sessions: OmnigentSessionSummary[];
  items: OmnigentItem[];
}

/**
 * Minimal, unpolished live view of Omnigent's shared-session activity feed —
 * proof that cross-agent visibility works end to end, not a finished
 * surface. See docs/omnigent-integration-plan.md (Phase 1).
 */
export function OmnigentActivity() {
  const { data, isLoading } = useQuery<ActivityResponse>({
    queryKey: ['omnigent', 'activity'],
    queryFn: async () => {
      const res = await fetch('/api/omnigent/activity');
      if (!res.ok) throw new Error(`activity fetch failed (${res.status})`);
      return res.json();
    },
    refetchInterval: 5_000,
  });

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading…</p>;

  if (!data?.reachable) {
    return (
      <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
        Omnigent server unreachable — dev-only shared-session bridge (see
        docs/omnigent-integration-plan.md). Not required for the app to work.
      </p>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-1.5 shrink-0">
        <Radio className="size-3 text-neon-cyan" aria-hidden />
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Omnigent — shared-session activity
        </span>
        <span className="font-terminal text-[10px] text-muted-foreground/40">
          {data.sessions.length} session{data.sessions.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1">
        {data.items.length === 0 ? (
          <p className="text-xs text-muted-foreground/50">No activity yet.</p>
        ) : (
          data.items.map((item) => {
            const text = item.content?.map((c) => c.text).join(' ') ?? '';
            const isUser = item.role === 'user';
            return (
              <div
                key={item.id}
                className={cn(
                  'rounded-md border px-2.5 py-1.5 text-xs',
                  isUser ? 'border-border bg-surface-2 text-foreground/70' : 'border-neon-cyan/25 bg-neon-cyan/[0.04] text-foreground/90'
                )}
              >
                <span className="mr-1.5 font-terminal text-[9px] uppercase tracking-wider text-muted-foreground/40">
                  {isUser ? 'sent' : 'agent'}
                </span>
                {text}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

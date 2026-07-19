'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MentorFeedbackSummary } from '@/app/api/feedback/summary/route';

/** Modest per-mentor feedback rollup — the seed of the future eval system.
 *  Read-only; the numbers come straight from feedback_events. */
export function MentorSignalsPanel() {
  const [summaries, setSummaries] = useState<MentorFeedbackSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    fetch('/api/feedback/summary', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`summary failed (${res.status})`))))
      .then((data: { summaries?: MentorFeedbackSummary[] }) => {
        setSummaries(Array.isArray(data.summaries) ? data.summaries : []);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'failed to load'));
  };

  useEffect(load, []);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-2.5 text-xs">
      <div className="flex items-center">
        <p className="font-terminal text-[10px] text-muted-foreground">
          {summaries === null && !error ? 'loading…' : `${summaries?.length ?? 0} mentor${(summaries?.length ?? 0) === 1 ? '' : 's'} with signals`}
        </p>
        <Button variant="ghost" size="icon-sm" className="ml-auto" title="Refresh" onClick={load}>
          <RefreshCw className="size-3" />
        </Button>
      </div>
      {error && (
        <p className="flex items-center gap-1.5 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-destructive">
          <AlertTriangle className="size-3 shrink-0" /> {error}
        </p>
      )}
      {summaries !== null && summaries.length === 0 && !error && (
        <p className="rounded-md border border-dashed border-border p-3 text-muted-foreground">
          No signals yet. Talk to a mentor — replies, fact proposals, and your thumbs land here.
        </p>
      )}
      {(summaries ?? []).map((s) => (
        <div key={s.mentorId} className="rounded-md border border-border p-2">
          <div className="flex items-center justify-between">
            <span className="font-medium text-foreground">{s.mentorId}</span>
            <span className="font-terminal text-[10px] text-muted-foreground">
              {s.replies} repl{s.replies === 1 ? 'y' : 'ies'}
              {s.errors > 0 ? ` · ${s.errors} err` : ''}
              {s.medianLatencyMs !== null ? ` · ~${(s.medianLatencyMs / 1000).toFixed(1)}s median` : ''}
            </span>
          </div>
          <p className="mt-1 font-terminal text-[10px] text-muted-foreground">
            facts: {s.factsProposed} proposed · {s.factsAutoSaved} auto-saved · {s.factsConfirmed} confirmed · {s.factsEdited} edited · {s.factsDiscarded} discarded
            {s.factsExpired > 0 ? ` · ${s.factsExpired} expired` : ''}
          </p>
          <p className="mt-0.5 font-terminal text-[10px] text-muted-foreground/70">
            👍 {s.thumbsUp} · 👎 {s.thumbsDown}
            {s.localShare !== null ? ` · ${Math.round(s.localShare * 100)}% local backend` : ''}
          </p>
        </div>
      ))}
    </div>
  );
}

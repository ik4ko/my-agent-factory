'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useConnectionStore, selectOverallStatus } from '@/lib/realtime/connection-store';
import { AGENTS_KEY } from '@/hooks/use-agents-query';
import { TASKS_KEY } from '@/hooks/use-tasks-query';
import { LOGS_KEY } from '@/hooks/use-logs-query';
import type { Agent, Log, Task } from '@/lib/types/database.types';

/**
 * useSocketReconciliation — the drag-net telemetry recovery layer.
 *
 * postgres_changes does NOT replay rows missed while a socket was down. This
 * hook watches the connection store's collapsed status; when the client
 * transitions out of `connected` it stamps `disconnectedAt`, and on the
 * transition BACK to `connected` it delta-fetches every mutation that
 * happened in the gap (minus a safety skew) and merges it into the TanStack
 * caches:
 *
 *  - agents: full refetch-and-replace (the fleet is a handful of rows; a
 *    delta adds complexity with zero savings). Memoized cards re-render at
 *    most once.
 *  - tasks:  updated_at > gap ∪ cache, deduped by id (updated row wins),
 *    re-sorted newest-first, re-capped — identical shape to the live cache,
 *    so no visual jitter.
 *  - logs:   timestamp > gap appended with id-dedupe, chronological order
 *    preserved, ring-capped like the live flusher.
 *
 * Mount exactly ONCE (DashboardClient). Reconciliations are serialized —
 * a flapping connection can't stack concurrent merges.
 */

const SAFETY_SKEW_MS = 30_000; // clock skew + in-flight events at drop time
const TASKS_CAP = 20;
const LOGS_CAP = 120;

export function useSocketReconciliation(): void {
  const qc = useQueryClient();
  const status = useConnectionStore(selectOverallStatus);
  const prevStatusRef = useRef(status);
  const disconnectedAtRef = useRef<number | null>(null);
  const reconcilingRef = useRef(false);

  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;

    // Leaving healthy state → stamp the gap start (first drop wins).
    if (prev === 'connected' && status !== 'connected' && disconnectedAtRef.current === null) {
      disconnectedAtRef.current = Date.now();
      return;
    }

    // Re-entering healthy state after a recorded gap → reconcile.
    if (status !== 'connected' || disconnectedAtRef.current === null || reconcilingRef.current) {
      return;
    }

    const since = new Date(disconnectedAtRef.current - SAFETY_SKEW_MS).toISOString();
    disconnectedAtRef.current = null;
    reconcilingRef.current = true;

    void (async () => {
      try {
        const supabase = createClient();
        const [agentsRes, tasksRes, logsRes] = await Promise.all([
          supabase.from('agents').select('*').order('created_at', { ascending: true }),
          supabase.from('tasks').select('*').gte('updated_at', since).order('created_at', { ascending: false }).limit(TASKS_CAP),
          supabase.from('logs').select('*').gte('timestamp', since).order('timestamp', { ascending: true }).limit(LOGS_CAP),
        ]);

        // agents: replace wholesale (small, authoritative).
        if (!agentsRes.error && agentsRes.data) {
          qc.setQueryData<Agent[]>(AGENTS_KEY, agentsRes.data);
        }

        // tasks: merge by id — the fresher (delta) row wins; shape preserved.
        if (!tasksRes.error && tasksRes.data && tasksRes.data.length > 0) {
          const delta = tasksRes.data as Task[];
          qc.setQueryData<Task[]>(TASKS_KEY, (prev = []) => {
            const byId = new Map(prev.map((t) => [t.id, t]));
            for (const t of delta) byId.set(t.id, t);
            return [...byId.values()]
              .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
              .slice(0, TASKS_CAP);
          });
        }

        // logs: append missed lines chronologically, id-deduped, ring-capped.
        if (!logsRes.error && logsRes.data && logsRes.data.length > 0) {
          const delta = logsRes.data as Log[];
          qc.setQueryData<Log[]>(LOGS_KEY, (prev = []) => {
            const seen = new Set(prev.map((l) => l.id));
            const missed = delta.filter((l) => !seen.has(l.id));
            if (missed.length === 0) return prev;
            return [...prev, ...missed]
              .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
              .slice(-LOGS_CAP);
          });
        }

        // Reconciliation is intentionally silent; consumers observe the merged caches.
      } catch (err) {
        console.warn('[socket-reconciliation]', err);
      } finally {
        reconcilingRef.current = false;
      }
    })();
  }, [status, qc]);
}

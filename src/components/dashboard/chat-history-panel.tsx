'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock3, MessageSquare, RefreshCw } from 'lucide-react';
import type { ChatHistoryScope, ChatHistoryTurn } from '@/lib/chat/history';
import { CHAT_HISTORY_UPDATED_EVENT } from '@/lib/chat/events';
import { shortModel } from '@/lib/telemetry/pricing';
import { cn } from '@/lib/utils';

const DEFAULT_SCOPES: Array<{ scope: ChatHistoryScope; label: string }> = [
  { scope: 'hub', label: 'Hub' },
  { scope: 'trading', label: 'Trading' },
  { scope: 'coding', label: 'Coding' },
  { scope: 'personal', label: 'Personal' },
];

interface HistoryItem extends ChatHistoryTurn {
  scope: ChatHistoryScope;
  scopeLabel: string;
}

interface ActivityItem {
  id: string;
  kind: 'chat' | 'metric' | 'task' | 'bus' | 'staged_order';
  createdAt: string;
  scope?: ChatHistoryScope;
  role?: 'user' | 'assistant';
  actor: string;
  content: string;
  model?: string | null;
  error?: boolean;
  materialized?: ChatHistoryTurn['materialized'];
  event?: string;
  status?: string;
  intentKind?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  taskId?: string | null;
  pipelineId?: string | null;
  sourceSignalId?: string | null;
  strategyLabel?: string | null;
}

interface ActivityResponse {
  items?: ActivityItem[];
  summary?: {
    totalTokens?: number;
    totalCostUsd?: number;
  };
}

async function fetchScope(scope: ChatHistoryScope): Promise<ChatHistoryTurn[]> {
  const res = await fetch(`/api/chat-history?scope=${encodeURIComponent(scope)}`, { cache: 'no-store' });
  const data = (await res.json().catch(() => null)) as { turns?: ChatHistoryTurn[]; error?: string } | null;
  if (!res.ok) {
    throw new Error(data?.error ?? `chat history read failed for ${scope}`);
  }
  return Array.isArray(data?.turns) ? data.turns : [];
}

function labelForScope(scope: ChatHistoryScope | undefined, scopes: Array<{ scope: ChatHistoryScope; label: string }>): string {
  if (!scope) return 'System';
  return scopes.find((item) => item.scope === scope)?.label ?? scope;
}

function relativeTime(value: string | undefined): string {
  if (!value) return 'just now';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return 'just now';
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function tokenSummary(item: ActivityItem): string | null {
  const tokens = (item.inputTokens ?? 0) + (item.outputTokens ?? 0);
  const cost = item.costUsd ?? 0;
  if (tokens <= 0 && cost <= 0) return null;
  return [tokens > 0 ? `${tokens.toLocaleString()} tok` : null, cost > 0 ? `$${cost.toFixed(4)}` : null]
    .filter(Boolean)
    .join(' · ');
}

export function ChatHistoryPanel({
  scopes = DEFAULT_SCOPES,
  maxItems = 24,
  mode = 'chat',
}: {
  scopes?: Array<{ scope: ChatHistoryScope; label: string }>;
  maxItems?: number;
  mode?: 'chat' | 'activity';
}) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [summary, setSummary] = useState<ActivityResponse['summary']>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (mode === 'activity') {
        const params = new URLSearchParams({
          scopes: scopes.map(({ scope }) => scope).join(','),
          limit: String(maxItems),
          includeMetrics: '1',
          includeTasks: '1',
          includeGlobal: '1',
        });
        const res = await fetch(`/api/activity?${params.toString()}`, { cache: 'no-store' });
        const data = (await res.json().catch(() => null)) as ActivityResponse & { error?: string } | null;
        if (!res.ok) {
          throw new Error(data?.error ?? `activity read failed (${res.status})`);
        }
        setActivity(Array.isArray(data?.items) ? data.items : []);
        setSummary(data?.summary);
        return;
      }

      const rows = await Promise.all(
        scopes.map(async ({ scope, label }) => {
          const turns = await fetchScope(scope);
          return turns.map((turn) => ({ ...turn, scope, scopeLabel: label }));
        }),
      );
      setItems(
        rows
          .flat()
          .filter((turn) => turn.content.trim())
          .sort((a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? ''))
          .slice(0, maxItems),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : `failed to load ${mode === 'activity' ? 'activity' : 'history'}`;
      setError(message);
      setActivity([]);
      setItems([]);
      setSummary(undefined);
    } finally {
      setLoading(false);
    }
  }, [maxItems, mode, scopes]);

  useEffect(() => {
    // Data fetch on mount. The loader is async and sets state around an await;
    // this is React's documented pattern for loading data in a client component,
    // not derived state feeding a cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const scoped = new Set(scopes.map(({ scope }) => scope));
    const onHistoryUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ scope?: ChatHistoryScope }>).detail;
      if (!detail?.scope || scoped.has(detail.scope)) void refresh();
    };

    window.addEventListener(CHAT_HISTORY_UPDATED_EVENT, onHistoryUpdated);
    return () => window.removeEventListener(CHAT_HISTORY_UPDATED_EVENT, onHistoryUpdated);
  }, [refresh, scopes]);

  // Operational events (tasks, ledger HALTs, staged-order approvals, bus
  // thoughts) never emit CHAT_HISTORY_UPDATED_EVENT, so the activity feed would
  // otherwise only refresh on a chat turn or a manual click. Poll while the tab
  // is visible so the timeline stays trustworthy; pause when hidden to avoid
  // pointless reads. Chat mode is event-driven and does not poll.
  useEffect(() => {
    if (mode !== 'activity') return;
    const POLL_MS = 20_000;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [mode, refresh]);

  const grouped = useMemo(() => items, [items]);
  const isActivity = mode === 'activity';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        {isActivity ? <Activity className="size-3.5 text-primary" aria-hidden /> : <Clock3 className="size-3.5 text-primary" aria-hidden />}
        <span className="font-terminal text-[10px] uppercase tracking-widest text-muted-foreground">
          {isActivity ? 'Activity' : 'History'}
        </span>
        {isActivity && summary && (
          <span className="hidden truncate font-terminal text-[9px] text-muted-foreground/45 sm:inline">
            {summary.totalTokens?.toLocaleString() ?? 0} tok · ${(summary.totalCostUsd ?? 0).toFixed(3)}
          </span>
        )}
        <button
          type="button"
          onClick={() => void refresh()}
          aria-label="Refresh chat history"
          className="ml-auto rounded p-1 text-muted-foreground/35 transition-colors hover:text-foreground"
        >
          <RefreshCw className={cn('size-3', loading && 'animate-spin')} aria-hidden />
        </button>
      </div>

      {error && (
        <div className="mx-2 mt-2 flex items-center gap-2 rounded border border-neon-red/35 bg-neon-red/[0.06] px-2 py-1.5">
          <AlertTriangle className="size-3 shrink-0 text-neon-red/80" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-mono text-[9px] text-neon-red/80">{error}</span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded border border-neon-red/30 px-1.5 py-px font-terminal text-[8px] uppercase tracking-wider text-neon-red/80 transition-colors hover:bg-neon-red/10"
          >
            Retry
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <p className="py-6 text-center font-terminal text-[10px] text-muted-foreground/40">
            loading {isActivity ? 'activity' : 'history'}...
          </p>
        ) : isActivity ? (
          activity.length === 0 ? (
            <p className="py-6 text-center font-terminal text-[10px] text-muted-foreground/40">No saved activity yet.</p>
          ) : (
            <div className="space-y-1.5">
              {activity.map((item) => {
                const isError = Boolean(item.error);
                const meta = tokenSummary(item);
                return (
                  <div
                    key={item.id}
                    className={cn(
                      'rounded-md border px-2.5 py-2',
                      isError ? 'border-neon-red/35 bg-neon-red/[0.05]' : 'border-border/60 bg-surface-1/50',
                    )}
                  >
                    <div className="mb-1 flex min-w-0 items-center gap-1.5 font-terminal text-[9px] uppercase tracking-wider">
                      {item.kind === 'task' || item.kind === 'staged_order' ? (
                        <CheckCircle2 className="size-3 shrink-0 text-neon-green/70" aria-hidden />
                      ) : item.kind === 'metric' ? (
                        <Activity className="size-3 shrink-0 text-primary/70" aria-hidden />
                      ) : (
                        <MessageSquare className="size-3 shrink-0 text-primary/70" aria-hidden />
                      )}
                      <span className={cn(isError ? 'text-neon-red/80' : 'text-primary')}>{labelForScope(item.scope, scopes)}</span>
                      <span className="truncate text-muted-foreground/55">{item.actor}</span>
                      <span className="rounded border border-border/70 px-1 py-px text-muted-foreground/50">
                        {item.kind === 'staged_order' ? 'order' : item.kind}
                      </span>
                      {item.model && <span className="truncate text-muted-foreground/35">· {shortModel(item.model)}</span>}
                      {item.status && (
                        <span className={cn('rounded border px-1 py-px', isError ? 'border-neon-red/35 text-neon-red/75' : 'border-neon-green/30 text-neon-green/70')}>
                          {item.status}
                        </span>
                      )}
                      {item.intentKind && (
                        <span className="rounded border border-border/70 px-1 py-px text-muted-foreground/55">
                          {item.intentKind}
                        </span>
                      )}
                      {item.strategyLabel && (
                        <span className="rounded border border-border/70 px-1 py-px text-muted-foreground/55">
                          {item.strategyLabel}
                        </span>
                      )}
                      {item.event && <span className="rounded border border-border/70 px-1 py-px text-muted-foreground/55">{item.event}</span>}
                      {item.taskId && (
                        <span className="rounded border border-border/70 px-1 py-px text-muted-foreground/55">
                          task {item.taskId.slice(0, 8)}
                        </span>
                      )}
                      {item.pipelineId && (
                        <span className="rounded border border-border/70 px-1 py-px text-muted-foreground/55">
                          pipe {item.pipelineId.slice(0, 8)}
                        </span>
                      )}
                      {item.sourceSignalId && (
                        <span className="rounded border border-border/70 px-1 py-px text-muted-foreground/55">
                          signal {item.sourceSignalId.slice(0, 8)}
                        </span>
                      )}
                      {item.model === 'budget-gate' && (
                        <span className="rounded border border-neon-red/40 px-1 py-px text-neon-red/80">budget halt</span>
                      )}
                      {isError && item.model !== 'budget-gate' && <AlertTriangle className="size-3 text-neon-red/75" aria-hidden />}
                      <span className="ml-auto shrink-0 text-muted-foreground/35">{relativeTime(item.createdAt)}</span>
                    </div>
                    <p className={cn('line-clamp-3 text-xs leading-relaxed', isError ? 'text-neon-red/90' : 'text-foreground/80')}>
                      {item.content}
                    </p>
                    {(meta || item.materialized?.length) && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {meta && <span className="rounded border border-border/70 px-1.5 py-px font-terminal text-[9px] text-muted-foreground/60">{meta}</span>}
                        {item.materialized?.map((artifact) => (
                          <span
                            key={`${artifact.type}:${artifact.id}`}
                            className={cn(
                              'rounded border px-1.5 py-px font-terminal text-[9px] tracking-wide',
                              artifact.type === 'staged_order' ? 'border-neon-green/40 text-neon-green/80' : 'border-primary/40 text-primary/80',
                            )}
                          >
                            {artifact.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        ) : grouped.length === 0 ? (
          <p className="py-6 text-center font-terminal text-[10px] text-muted-foreground/40">No saved room chat yet.</p>
        ) : (
          <div className="space-y-1.5">
            {grouped.map((item, index) => (
              <div
                key={`${item.scope}-${item.createdAt ?? index}-${index}`}
                className={cn(
                  'rounded-md border px-2.5 py-2',
                  item.error ? 'border-neon-red/35 bg-neon-red/[0.05]' : 'border-border/60 bg-surface-1/50',
                )}
              >
                <div className="mb-1 flex items-center gap-2 font-terminal text-[9px] uppercase tracking-wider">
                  <span className="text-primary">{item.scopeLabel}</span>
                  <span className={cn(item.role === 'user' ? 'text-muted-foreground/45' : item.error ? 'text-neon-red/75' : 'text-neon-green/70')}>
                    {item.role === 'user' ? 'you' : item.agentId ?? 'assistant'}
                  </span>
                  {item.model && <span className="truncate text-muted-foreground/35">· {shortModel(item.model)}</span>}
                  {item.model === 'budget-gate' && (
                    <span className="rounded border border-neon-red/40 px-1 py-px text-neon-red/80">budget halt</span>
                  )}
                  <span className="ml-auto text-muted-foreground/35">{relativeTime(item.createdAt)}</span>
                </div>
                <p className={cn('line-clamp-3 text-xs leading-relaxed', item.error ? 'text-neon-red/90' : 'text-foreground/80')}>{item.content}</p>
                {item.materialized && item.materialized.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {item.materialized.map((artifact) => (
                      <span
                        key={`${artifact.type}:${artifact.id}`}
                        className={cn(
                          'rounded border px-1.5 py-px font-terminal text-[9px] tracking-wide',
                          artifact.type === 'staged_order' ? 'border-neon-green/40 text-neon-green/80' : 'border-primary/40 text-primary/80',
                        )}
                      >
                        {artifact.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

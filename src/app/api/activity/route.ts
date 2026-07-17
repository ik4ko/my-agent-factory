import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readChatHistory, type ChatHistoryScope } from '@/lib/chat/history';
import { getAdminClient } from '@/lib/supabase/admin';
import { estimateMetricCostUsd } from '@/lib/telemetry/pricing';
import type { ChatHistoryMaterializedArtifact } from '@/lib/chat/history';
import { roomsByAgentId, resolveTaskRoomScope, type RoomScope } from '@/lib/rooms/scope';
import type { Agent, Metric, StagedOrderRow, SystemBusRow, Task } from '@/lib/types/database.types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ScopeSchema = z.enum(['hub', 'trading', 'coding', 'personal', 'ceo', 'matrix']);
const DEFAULT_SCOPES: ChatHistoryScope[] = ['hub', 'trading', 'coding', 'personal'];

type ActivityItem =
  | {
      id: string;
      kind: 'chat';
      createdAt: string;
      scope: ChatHistoryScope;
      role: 'user' | 'assistant';
      actor: string;
      content: string;
      model?: string;
      error?: boolean;
      materialized?: ChatHistoryMaterializedArtifact[];
    }
  | {
      id: string;
      kind: 'metric';
      createdAt: string;
      scope?: ChatHistoryScope;
      actor: string;
      content: string;
      model: string;
      event: string;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      taskId?: string | null;
      error?: boolean;
    }
  | {
      id: string;
      kind: 'task';
      createdAt: string;
      scope?: ChatHistoryScope;
      actor: string;
      content: string;
      taskId: string;
      status: string;
      model?: string | null;
      error?: boolean;
    }
  | {
      id: string;
      kind: 'bus';
      createdAt: string;
      scope?: ChatHistoryScope;
      actor: string;
      content: string;
      model?: string | null;
      taskId?: string | null;
      pipelineId?: string | null;
      status?: string;
      error?: boolean;
    }
  | {
      id: string;
      kind: 'staged_order';
      createdAt: string;
      scope: 'trading';
      actor: string;
      content: string;
      status: string;
      intentKind?: string | null;
      pipelineId?: string | null;
      sourceSignalId?: string | null;
      strategyLabel?: string | null;
      error?: boolean;
    };

function parseLimit(req: NextRequest): number {
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? 60);
  return Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 10), 120) : 60;
}

function parseScopes(req: NextRequest): ChatHistoryScope[] {
  const raw = req.nextUrl.searchParams.get('scopes');
  if (!raw) return DEFAULT_SCOPES;
  const scopes = raw
    .split(',')
    .map((part) => ScopeSchema.safeParse(part.trim()))
    .filter((parsed): parsed is z.SafeParseSuccess<ChatHistoryScope> => parsed.success)
    .map((parsed) => parsed.data);
  return scopes.length > 0 ? Array.from(new Set(scopes)) : DEFAULT_SCOPES;
}

function boolParam(req: NextRequest, name: string, fallback = false): boolean {
  const value = req.nextUrl.searchParams.get(name);
  if (value === null) return fallback;
  return value === '1' || value === 'true';
}

function metricScope(detail: string | null): ChatHistoryScope | undefined {
  const value = detail?.match(/\bscope=([a-z_]+)/i)?.[1];
  const parsed = ScopeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function metricCost(metric: Metric): number {
  const explicit = metric.detail?.match(/\best_usd=([0-9.]+)/i)?.[1];
  const value = Number(explicit);
  return Number.isFinite(value) ? value : estimateMetricCostUsd(metric);
}

async function readPagedRows<T>(fetchPage: (offset: number, pageSize: number) => Promise<T[]>, pageSize = 120): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await fetchPage(offset, pageSize);
    if (page.length === 0) break;
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function taskScopeFromRoomScope(scope: RoomScope): ChatHistoryScope | undefined {
  if (scope === 'trading' || scope === 'coding') return scope;
  return undefined;
}

function taskResultPreview(result: Record<string, unknown> | null | undefined): string {
  if (!result) return '';
  for (const key of ['summary', 'output', 'content', 'text', 'message', 'error']) {
    const value = result[key];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 260);
  }
  return JSON.stringify(result).slice(0, 260);
}

function busPayloadPreview(payload: Record<string, unknown>): string {
  for (const key of ['reply', 'preview', 'output', 'task', 'heard', 'error']) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 260);
  }
  return JSON.stringify(payload).slice(0, 260);
}

function busPayloadModel(payload: Record<string, unknown>): string | null {
  const model = payload.model;
  return typeof model === 'string' && model.trim() ? model : null;
}

function busPayloadScope(payload: Record<string, unknown>): ChatHistoryScope | undefined {
  const raw = typeof payload.scope === 'string' ? payload.scope : undefined;
  const parsed = ScopeSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

function metricSummary(metric: Metric, costUsd: number): string {
  const tokens = (metric.input_tokens ?? 0) + (metric.output_tokens ?? 0);
  const tokenPart = tokens > 0 ? `${tokens.toLocaleString()} tokens` : 'no token count';
  const costPart = costUsd > 0 ? ` - ~$${costUsd.toFixed(4)}` : '';
  const detail = metric.detail ? ` - ${metric.detail}` : '';
  return `${metric.event} - ${tokenPart}${costPart}${detail}`;
}

function activityDedupKey(item: ActivityItem): string {
  const meta = item as {
    model?: string | null;
    event?: string;
    status?: string;
    taskId?: string | null;
    pipelineId?: string | null;
    sourceSignalId?: string | null;
  };
  return [
    item.kind,
    item.createdAt,
    item.scope ?? '',
    item.actor,
    meta.model ?? '',
    meta.event ?? '',
    meta.status ?? '',
    meta.taskId ?? '',
    meta.pipelineId ?? '',
    meta.sourceSignalId ?? '',
    item.content.replace(/\s+/g, ' ').trim().slice(0, 180),
  ].join('|');
}

function dedupeActivity(items: ActivityItem[]): ActivityItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = activityDedupKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function readAgentsRoomMap(): Promise<ReadonlyMap<string, Exclude<RoomScope, 'all'>[]>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getAdminClient() as any;
  const { data, error } = await db.from('agents').select('id, type').order('created_at', { ascending: true });
  if (error) throw new Error(`agents read failed: ${error.message}`);
  return roomsByAgentId((data ?? []) as Agent[]);
}

function metricScopeFromTask(metric: Metric, scopeByTaskId: ReadonlyMap<string, ChatHistoryScope | undefined>): ChatHistoryScope | undefined {
  if (!metric.task_id) return undefined;
  return scopeByTaskId.get(metric.task_id);
}

async function readMetrics(
  scopes: Set<ChatHistoryScope>,
  includeGlobal: boolean,
  scopeByTaskId: ReadonlyMap<string, ChatHistoryScope | undefined>,
): Promise<{ items: ActivityItem[]; tokens: number; costUsd: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getAdminClient() as any;
  const rows = await readPagedRows<Metric>(async (offset, pageSize) => {
    const { data, error } = await db
      .from('metrics')
      .select('id, task_id, agent_id, model, event, input_tokens, output_tokens, detail, created_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`metrics read failed: ${error.message}`);
    return (data ?? []) as Metric[];
  });

  let tokens = 0;
  let costUsd = 0;
  const items: ActivityItem[] = [];
  for (const metric of rows) {
    const scope = metricScope(metric.detail) ?? metricScopeFromTask(metric, scopeByTaskId);
    if (scope && !scopes.has(scope)) continue;
    if (!scope && !includeGlobal) continue;
    const cost = metricCost(metric);
    tokens += (metric.input_tokens ?? 0) + (metric.output_tokens ?? 0);
    costUsd += cost;
    items.push({
      id: `metric:${metric.id}`,
      kind: 'metric',
      createdAt: metric.created_at,
      ...(scope ? { scope } : {}),
      actor: metric.agent_id ?? 'ledger',
      content: metricSummary(metric, cost),
      model: metric.model,
      event: metric.event,
      inputTokens: metric.input_tokens ?? 0,
      outputTokens: metric.output_tokens ?? 0,
      costUsd: cost,
      ...(metric.task_id ? { taskId: metric.task_id } : {}),
      ...(metric.event === 'HALT' ? { error: true } : {}),
    });
  }

  return { items, tokens, costUsd };
}

async function readTasks(
  roomsMap: ReadonlyMap<string, Exclude<RoomScope, 'all'>[]>,
): Promise<{ items: ActivityItem[]; scopeByTaskId: Map<string, ChatHistoryScope | undefined> }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getAdminClient() as any;
  const rows = await readPagedRows(async (offset, pageSize) => {
    const { data, error } = await db
      .from('tasks')
      .select('id, agent_id, description, status, model, result, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`tasks read failed: ${error.message}`);
    return (data ?? []) as Pick<Task, 'id' | 'agent_id' | 'description' | 'status' | 'model' | 'result' | 'created_at' | 'updated_at'>[];
  });

  const scopeByTaskId = new Map<string, ChatHistoryScope | undefined>();
  const items = rows.map((task) => {
    const preview = taskResultPreview(task.result);
    const content = preview ? `${task.description} - ${preview}` : task.description;
    const scope = taskScopeFromRoomScope(resolveTaskRoomScope(task, roomsMap));
    scopeByTaskId.set(task.id, scope);
    return {
      id: `task:${task.id}`,
      kind: 'task' as const,
      createdAt: task.updated_at ?? task.created_at,
      ...(scope ? { scope } : {}),
      actor: 'task runner',
      content,
      taskId: task.id,
      status: task.status,
      model: task.model,
      ...(task.status === 'failed' || task.status === 'cancelled' ? { error: true } : {}),
    };
  });

  return { items, scopeByTaskId };
}

async function readBusThoughts(scopeByTaskId: ReadonlyMap<string, ChatHistoryScope | undefined>): Promise<ActivityItem[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getAdminClient() as any;
  const rows = await readPagedRows<Pick<SystemBusRow, 'id' | 'agent' | 'task_id' | 'pipeline_id' | 'payload' | 'status' | 'created_at'>>(async (offset, pageSize) => {
    const { data, error } = await db
      .from('system_bus')
      .select('id, topic, agent, task_id, pipeline_id, payload, status, created_at')
      .eq('topic', 'agent.thought')
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`system_bus read failed: ${error.message}`);
    return (data ?? []) as Pick<SystemBusRow, 'id' | 'agent' | 'task_id' | 'pipeline_id' | 'payload' | 'status' | 'created_at'>[];
  });

  return rows.map((event) => {
    const model = busPayloadModel(event.payload);
    const scope = busPayloadScope(event.payload) ?? (event.task_id ? scopeByTaskId.get(event.task_id) : undefined);
    return {
      id: `bus:${event.id}`,
      kind: 'bus' as const,
      createdAt: event.created_at,
      ...(scope ? { scope } : {}),
      actor: event.agent ?? 'agent bus',
      content: busPayloadPreview(event.payload),
      ...(model ? { model } : {}),
      taskId: event.task_id,
      pipelineId: event.pipeline_id,
      status: event.status,
      ...(event.status === 'failed' ? { error: true } : {}),
    };
  });
}

async function readStagedOrders(scopes: Set<ChatHistoryScope>): Promise<ActivityItem[]> {
  if (!scopes.has('trading')) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getAdminClient() as any;
  const rows = await readPagedRows<Partial<StagedOrderRow>>(async (offset, pageSize) => {
    const { data, error } = await db
      .from('staged_orders')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`staged_orders read failed: ${error.message}`);
    return (data ?? []) as Partial<StagedOrderRow>[];
  });

  return rows.map((order) => ({
    id: `staged:${order.id}`,
    kind: 'staged_order' as const,
    createdAt: order.created_at ?? new Date().toISOString(),
    scope: 'trading',
    actor: 'staged order',
    content:
      order.intent_kind === 'option_intent'
        ? [
            'OPTION INTENT',
            `${order.action ?? 'action?'} ${order.contracts ?? '?'}x ${order.underlying ?? 'underlying?'} ${order.expiration ?? 'exp?'} ${order.strike ?? '?'} ${order.option_type ?? 'CALL'} @ ${Number(order.limit_price ?? 0).toFixed(2)} ${order.price_effect ?? ''}`.trim(),
            `max premium ${Number(order.max_premium_usd ?? 0).toFixed(0)} - max loss ${Number(order.max_loss_usd ?? 0).toFixed(0)}`,
            `strategy ${order.strategy_label ?? 'n/a'}${order.source_signal_id ? ` - signal ${String(order.source_signal_id).slice(0, 8)}` : ''}`,
          ].join(' - ')
        : `${order.underlying ?? 'staged order'} ${order.option_type ?? 'CALL'} ${order.strike ?? '?'} ${order.expiration ?? 'n/a'} @ ${Number(order.limit_price ?? 0).toFixed(2)} - size ${Number(order.calculated_position_size_usd ?? 0).toFixed(0)} - ${order.source ?? 'sandbox'}`,
    status: String(order.human_approval_status ?? 'PENDING'),
    intentKind: order.intent_kind ?? null,
    pipelineId: order.pipeline_id ?? null,
    sourceSignalId: order.source_signal_id ?? null,
    strategyLabel: order.strategy_label ?? null,
    ...(order.human_approval_status === 'DENIED' ? { error: true } : {}),
  }));
}

export async function GET(req: NextRequest) {
  const limit = parseLimit(req);
  const scopes = parseScopes(req);
  const scopeSet = new Set(scopes);
  const includeMetrics = boolParam(req, 'includeMetrics', true);
  const includeTasks = boolParam(req, 'includeTasks', true);
  const includeBus = boolParam(req, 'includeBus', true);
  const includeStagedOrders = boolParam(req, 'includeStagedOrders', true);
  const includeGlobal = boolParam(req, 'includeGlobal', false);

  try {
    const roomsMap = await readAgentsRoomMap();
    const taskBundle = includeTasks ? await readTasks(roomsMap) : { items: [], scopeByTaskId: new Map<string, ChatHistoryScope | undefined>() };
    const chatItems = (
      await Promise.all(
        scopes.map(async (scope) => {
          const turns = await readChatHistory(scope);
          return turns.map((turn, index): ActivityItem => ({
            id: `chat:${scope}:${turn.createdAt ?? index}:${index}`,
            kind: 'chat',
            createdAt: turn.createdAt ?? new Date().toISOString(),
            scope,
            role: turn.role,
            actor: turn.role === 'user' ? 'you' : turn.agentId ?? 'assistant',
            content: turn.content,
            ...(turn.model ? { model: turn.model } : {}),
            ...(turn.error ? { error: true } : {}),
            ...(turn.materialized?.length ? { materialized: turn.materialized } : {}),
          }));
        }),
      )
    ).flat();

    const metrics = includeMetrics ? await readMetrics(scopeSet, includeGlobal, taskBundle.scopeByTaskId) : { items: [], tokens: 0, costUsd: 0 };
    const busItems = includeBus ? await readBusThoughts(taskBundle.scopeByTaskId) : [];
    const stagedOrderItems = includeStagedOrders ? await readStagedOrders(scopeSet) : [];
    const items = dedupeActivity([...chatItems, ...metrics.items, ...taskBundle.items, ...busItems, ...stagedOrderItems])
      .filter((item) => item.content.trim())
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit);

    return NextResponse.json({
      items,
      summary: {
        scopes,
        totalTokens: metrics.tokens,
        totalCostUsd: metrics.costUsd,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'activity read failed', items: [] },
      { status: 500 },
    );
  }
}



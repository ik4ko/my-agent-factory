import { getAdminClient } from '@/lib/supabase/admin';

export type ChatHistoryScope = 'hub' | 'trading' | 'coding' | 'personal' | 'ceo' | 'matrix';

export interface ChatHistoryMaterializedArtifact {
  type: 'task' | 'staged_order';
  id: string;
  label: string;
}

export interface ChatHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
  agentId?: string;
  model?: string;
  error?: boolean;
  materialized?: ChatHistoryMaterializedArtifact[];
  createdAt?: string;
}

const MAX_TURNS = 80;
const MAX_CONTENT_CHARS = 16_000;

export function chatHistoryKey(scope: ChatHistoryScope): string {
  return `chat:${scope}:history`;
}

function cleanTurn(turn: ChatHistoryTurn): ChatHistoryTurn | null {
  const content = turn.content.trim().slice(0, MAX_CONTENT_CHARS);
  if (!content) return null;
  const materialized = Array.isArray(turn.materialized)
    ? turn.materialized
        .map((artifact) => ({
          type: artifact.type,
          id: String(artifact.id ?? '').trim().slice(0, 120),
          label: String(artifact.label ?? '').trim().slice(0, 180),
        }))
        .filter(
          (artifact): artifact is ChatHistoryMaterializedArtifact =>
            (artifact.type === 'task' || artifact.type === 'staged_order') && Boolean(artifact.id && artifact.label),
        )
        .slice(0, 6)
    : [];
  return {
    role: turn.role,
    content,
    ...(turn.agentId ? { agentId: turn.agentId } : {}),
    ...(turn.model ? { model: turn.model } : {}),
    ...(turn.error ? { error: true } : {}),
    ...(materialized.length > 0 ? { materialized } : {}),
    createdAt: turn.createdAt ?? new Date().toISOString(),
  };
}

function cleanTurns(turns: ChatHistoryTurn[]): ChatHistoryTurn[] {
  return turns
    .map(cleanTurn)
    .filter((turn): turn is ChatHistoryTurn => turn !== null)
    .slice(-MAX_TURNS);
}

function isUniqueViolation(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  return Boolean(error && (error.code === '23505' || /duplicate key/i.test(error.message ?? '')));
}

export async function readChatHistory(scope: ChatHistoryScope): Promise<ChatHistoryTurn[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getAdminClient() as any;
  const { data, error } = await db
    .from('memory')
    .select('id, value, updated_at')
    .eq('key', chatHistoryKey(scope))
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`[chat-history] read failed for ${scope}: ${error.message}`);

  const turns = Array.isArray(data?.value?.turns) ? data.value.turns : [];
  return cleanTurns(turns as ChatHistoryTurn[]);
}

export async function writeChatHistory(scope: ChatHistoryScope, turns: ChatHistoryTurn[]): Promise<ChatHistoryTurn[]> {
  const cleaned = cleanTurns(turns);
  const value = {
    kind: 'chat_history',
    scope,
    turns: cleaned,
    updatedAt: new Date().toISOString(),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getAdminClient() as any;
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: existing, error: readError } = await db
      .from('memory')
      .select('id, updated_at')
      .eq('key', chatHistoryKey(scope))
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (readError) {
      throw new Error(`[chat-history] write preflight failed for ${scope}: ${readError.message}`);
    }

    if (!existing?.id) {
      const { error: insertError } = await db.from('memory').insert({
        key: chatHistoryKey(scope),
        value,
        source: 'chat',
        tags: ['chat', scope],
      });

      if (!insertError) return cleaned;
      if (isUniqueViolation(insertError) && attempt < 3) continue;
      throw new Error(`[chat-history] insert failed for ${scope}: ${insertError.message}`);
    }

    const { data: updated, error: updateError } = await db
      .from('memory')
      .update({ value, source: 'chat', tags: ['chat', scope], updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .eq('updated_at', existing.updated_at)
      .select('id')
      .maybeSingle();

    if (updateError) {
      throw new Error(`[chat-history] update failed for ${scope}: ${updateError.message}`);
    }

    if (updated?.id) return cleaned;
  }

  throw new Error(`[chat-history] concurrent write retry exhausted for ${scope}`);
}

export async function appendChatHistory(scope: ChatHistoryScope, turns: ChatHistoryTurn[]): Promise<ChatHistoryTurn[]> {
  const current = await readChatHistory(scope);
  return writeChatHistory(scope, [...current, ...turns]);
}

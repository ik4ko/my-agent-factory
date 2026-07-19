import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { CHAT_HISTORY_SCOPES, readChatHistory, writeChatHistory, type ChatHistoryScope } from '@/lib/chat/history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ScopeSchema = z.enum(CHAT_HISTORY_SCOPES);
const TurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(16_000),
  agentId: z.string().max(80).optional(),
  model: z.string().max(160).optional(),
  error: z.boolean().optional(),
  materialized: z
    .array(
      z.object({
        type: z.enum(['task', 'staged_order']),
        id: z.string().min(1).max(120),
        label: z.string().min(1).max(180),
      }),
    )
    .max(6)
    .optional(),
  createdAt: z.string().max(80).optional(),
});

const WriteSchema = z.object({
  scope: ScopeSchema,
  turns: z.array(TurnSchema).max(80),
});

function parseScope(req: NextRequest): ChatHistoryScope {
  const parsed = ScopeSchema.safeParse(req.nextUrl.searchParams.get('scope') ?? 'ceo');
  return parsed.success ? parsed.data : 'ceo';
}

export async function GET(req: NextRequest) {
  try {
    const turns = await readChatHistory(parseScope(req));
    return NextResponse.json({ turns });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'chat history read failed', turns: [] },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const parsed = WriteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' }, { status: 400 });
  }

  try {
    const turns = await writeChatHistory(parsed.data.scope, parsed.data.turns);
    return NextResponse.json({ turns });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'chat history write failed' },
      { status: 500 },
    );
  }
}

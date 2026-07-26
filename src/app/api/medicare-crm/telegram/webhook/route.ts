import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireMedicareOperator } from '@/lib/medicare-crm/auth';

/**
 * Telegram boundary template. Provider verification, chat-to-client mapping,
 * and communication persistence are intentionally deferred until credentials
 * and an approved routing policy exist.
 */
const TelegramEventSchema = z.object({
  update_id: z.union([z.string(), z.number()]).optional(),
  message: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export async function POST(request: NextRequest) {
  const authError = await requireMedicareOperator(request);
  if (authError) return authError;

  const parsed = TelegramEventSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid Telegram payload' }, { status: 400 });
  return NextResponse.json({ configured: false, logged: false, message: 'Telegram webhook boundary is not configured.' }, { status: 501 });
}

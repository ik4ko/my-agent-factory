import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runHermesCommand } from '@/lib/hermes';

const CommandSchema = z.object({
  command: z.string().min(1, 'Command cannot be empty').max(1000, 'Command too long'),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = CommandSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const result = await runHermesCommand(parsed.data.command);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error', message: String(err) },
      { status: 500 }
    );
  }
}

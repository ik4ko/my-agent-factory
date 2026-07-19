import { NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';
import { runParallelMatrix } from '@/lib/pipeline/parallel-matrix';
import { claimAction, finishAction } from '@/lib/idempotency/claims';

/** POST /api/pipeline/matrix — fan one objective across up to three agents
 *  simultaneously (Hermes + Codex + Scout), then a cross-debate round, then a
 *  gated long-term-memory commit. Fire-and-forget: returns an instant 200 and
 *  runs the (slow, multi-LLM) matrix in the background via after(). Sandbox by
 *  default; pass simulate:false for a live run. */

const MatrixSchema = z.object({
  objective: z.string().min(1).max(1000),
  simulate: z.boolean().optional().default(true),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = MatrixSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const requestId = req.headers.get('idempotency-key')?.trim();
  if (!requestId) return NextResponse.json({ error: 'Idempotency-Key header is required' }, { status: 400 });
  const claim = await claimAction('pipeline:matrix', requestId, parsed.data);
  if (!claim.claimed) {
    if (claim.status === 'completed') return NextResponse.json(claim.response);
    return NextResponse.json({ error: 'Matrix start is already in progress', replayed: true }, { status: 409 });
  }

  after(async () => {
    await runParallelMatrix(parsed.data.objective, { simulate: parsed.data.simulate });
  });

  const response = { accepted: true, simulate: parsed.data.simulate };
  await finishAction('pipeline:matrix', requestId, response);
  return NextResponse.json(response);
}

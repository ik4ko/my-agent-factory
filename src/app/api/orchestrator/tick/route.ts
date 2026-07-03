import { NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';
import { triageTick, executeDispatches } from '@/lib/agents/orchestrator';

const Schema = z.object({ limit: z.number().int().min(1).max(20).optional() });

// Two-phase tick — auth-gated by src/middleware.ts like every API route.
// Phase 1 (triage/route/state-lock) runs on the HTTP path and returns
// immediately; phase 2 (streaming LLM workers) runs via after(), which
// extends the serverless lifetime beyond the response flush. All worker
// progress streams to the dashboard through Supabase Realtime, not this
// response.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = Schema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }
  try {
    const triage = await triageTick(parsed.data.limit ?? 5);
    if (triage.dispatches.length > 0) {
      after(() => executeDispatches(triage.dispatches));
    }
    return NextResponse.json({ ...triage, execution: 'background' });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Orchestrator tick failed' },
      { status: 500 }
    );
  }
}

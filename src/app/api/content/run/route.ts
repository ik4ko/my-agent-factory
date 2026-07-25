import { NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';
import { startPipeline, executeStep } from '@/lib/pipeline/engine';
import { CONTENT_CHANNEL_PLAYBOOK } from '@/lib/content/playbook';
import { isPipelineFullyWired } from '@/lib/content/integrations';
import { getAdminClient } from '@/lib/supabase/admin';
import type { ContentChannel } from '@/lib/types/database.types';
import type { PipelineRunResponse } from '@/lib/pipeline/types';

/**
 * POST /api/content/run — launch a content pipeline for ONE channel.
 *
 * Body: { channelId: uuid; objective: string; simulate?: boolean }
 *
 * Deliberately a thin wrapper over the SAME engine the trading pipeline uses
 * (startPipeline/executeStep) — there is no second orchestrator. The only
 * content-specific parts are the playbook name and the channel binding, which
 * stamps every step task's assigned_lane with the channel slug.
 *
 * simulate defaults to TRUE and is currently FORCED true: no content
 * integration has credentials yet (see src/lib/content/integrations.ts), so a
 * live run would produce prompts with nothing to execute against. The force
 * lifts automatically once every stage reports configured.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

const RunSchema = z.object({
  channelId: z.string().uuid('channelId must be a channel UUID'),
  objective: z.string().min(1, 'Objective cannot be empty').max(1000),
  simulate: z.boolean().optional().default(true),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = RunSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { data: channel, error } = await db()
    .from('content_channels')
    .select('*')
    .eq('id', parsed.data.channelId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!channel) return NextResponse.json({ error: 'Channel not found' }, { status: 404 });

  const row = channel as ContentChannel;

  // Until every stage has credentials, a "live" run has nothing real to call.
  // Forcing simulate keeps the room honest rather than silently producing an
  // identical trace under a different label.
  const simulate = parsed.data.simulate || !isPipelineFullyWired();

  let dispatch;
  try {
    dispatch = await startPipeline(parsed.data.objective, {
      simulate,
      playbook: CONTENT_CHANNEL_PLAYBOOK.name,
      channel: { id: row.id, slug: row.slug },
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to start content pipeline: ${String(err).slice(0, 200)}` },
      { status: 500 },
    );
  }

  // Chain runs after the response flushes; each stage dispatches the next and
  // streams through the existing tasks/logs realtime channels.
  after(async () => {
    await executeStep(dispatch);
  });

  const payload: PipelineRunResponse & { channel: { id: string; slug: string; label: string } } = {
    pipelineId: dispatch.context.id,
    playbook: dispatch.context.playbook,
    simulate: dispatch.context.simulate,
    firstStage: {
      role: dispatch.context.role,
      taskId: dispatch.taskId,
      agent: dispatch.agentName,
    },
    channel: { id: row.id, slug: row.slug, label: row.label },
  };
  return NextResponse.json(payload);
}

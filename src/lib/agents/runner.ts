import Anthropic from '@anthropic-ai/sdk';
import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { writeMemory } from '@/lib/hermes/memory-service';
import { recordModelEvent } from '@/lib/telemetry/token-ledger';
import { parseToolCalls } from '@/lib/sandbox/parser';
import { executeToolCalls } from '@/lib/sandbox/runner';
import type { AgentType } from '@/lib/types/database.types';

export interface AgentWorkerInput {
  taskId: string;
  agentId: string;
  agentType: AgentType;
  description: string;
  /** Model chosen by the orchestrator's router; defaults to the fast worker. */
  model?: string;
  /** Factory-built prompt (lane × task type); overrides the static persona. */
  systemPrompt?: string;
  /** Router lane; UP/DOWN tasks may drive the sandbox tool runner. */
  lane?: 'SEAT' | 'UP' | 'DOWN';
  /** Output budget override — pipeline stages request an expanded budget so
   *  the density directive in their prompts can actually be honored. */
  maxTokens?: number;
}

// claude-haiku-4-5: 1–3s per call — fits Vercel Hobby 10s limit.
const MODEL = 'claude-haiku-4-5';

// Throttle for incremental Supabase flushes while streaming (tasks/agents are
// in the realtime publication, so each flush renders live on the dashboard).
const FLUSH_INTERVAL_MS = 1_500;
const PREVIEW_CHARS = 400;

const PERSONAS: Record<AgentType, { label: string; system: string }> = {
  coder: {
    label: 'Codex',
    system: `You are Codex, an elite software engineer with mastery across all languages and paradigms.
Produce clean, production-ready code for the task. Structure your response as:
LANGUAGE: <language>
CODE:
\`\`\`<language>
<implementation>
\`\`\`
EXPLANATION: <1-2 sentences on approach and trade-offs>`,
  },
  researcher: {
    label: 'Scout',
    system: `You are Scout, an expert research analyst specializing in deep technical and strategic analysis.
Provide comprehensive findings with key insights and actionable takeaways.
Structure: FINDINGS | KEY INSIGHTS | RECOMMENDATIONS`,
  },
  browser: {
    label: 'Phantom',
    system: `You are Phantom, a web intelligence specialist. Simulate expert web research on the given topic.
Provide specific, realistic findings as if you had browsed authoritative sources.
Structure: SOURCES | EXTRACTED CONTENT | KEY DATA POINTS`,
  },
  planner: {
    label: 'Architect',
    system: `You are Architect, a strategic planning expert. Decompose complex objectives into executable plans.
Structure: OBJECTIVE | PHASES (numbered steps) | TIMELINE | SUCCESS CRITERIA`,
  },
  generic: {
    label: 'Hermes',
    system: `You are Hermes, a general-purpose AI assistant. Complete the task with a clear, well-structured response.`,
  },
};

let _anthropic: Anthropic | null = null;
function getAnthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

/**
 * Streaming worker. Consumes the Anthropic SSE stream and flushes incremental
 * progress (rolling output preview, char count, heartbeat) to Supabase every
 * ~1.5s so the dashboard terminal renders agent activity in real time.
 */
export async function runAgentWorker(input: AgentWorkerInput): Promise<void> {
  const { taskId, agentId, agentType, description } = input;
  const model = input.model ?? MODEL;
  const persona = PERSONAS[agentType] ?? PERSONAS.generic;

  await hermesLog(
    'info',
    `${persona.label} executing: "${description.slice(0, 80)}${description.length > 80 ? '…' : ''}"`,
    agentId
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getAdminClient() as any;

  let output = '';
  let inputTokens = 0;
  let outputTokens = 0;

  const flush = async (final: boolean) => {
    const now = new Date().toISOString();
    await Promise.all([
      db
        .from('tasks')
        .update({
          result: { streaming: !final, chars: output.length, preview: output.slice(-PREVIEW_CHARS), model },
          updated_at: now,
        })
        .eq('id', taskId),
      db.from('agents').update({ last_heartbeat: now }).eq('id', agentId),
    ]);
  };

  try {
    const stream = await getAnthropic().messages.create({
      model,
      max_tokens: input.maxTokens ?? 2048,
      system: input.systemPrompt ?? persona.system,
      messages: [{ role: 'user', content: description }],
      stream: true,
    });

    let lastFlush = Date.now();
    for await (const event of stream) {
      if (event.type === 'message_start') {
        inputTokens = event.message.usage?.input_tokens ?? 0;
      } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        output += event.delta.text;
      } else if (event.type === 'message_delta') {
        outputTokens = event.usage?.output_tokens ?? outputTokens; // cumulative
      }
      if (Date.now() - lastFlush >= FLUSH_INTERVAL_MS) {
        lastFlush = Date.now();
        await flush(false);
      }
    }
    output = output.trim();

    await flush(true);
    await Promise.all([
      db.from('tasks').update({ status: 'completed' }).eq('id', taskId),
      db.from('agents').update({ status: 'idle', current_task_id: null }).eq('id', agentId),
      // Token spend increment — feeds the 24h snapshot the router reads.
      recordModelEvent({ model, event: 'USAGE', taskId, agentId, inputTokens, outputTokens }),
    ]);

    await hermesLog('success', `${persona.label} task complete (${output.length} chars)`, agentId);

    await writeMemory(`agent:${agentType}:last_output`, {
      taskId,
      description,
      preview: output.slice(0, 400),
      model,
      completedAt: new Date().toISOString(),
    });

    // Pipeline hand-off — no-op unless this task was dispatched by the
    // pipeline engine. Receives the FULL output (tasks.result only holds a
    // preview). Dynamic import breaks the runner ↔ engine module cycle.
    try {
      const { advancePipelineAfterTask } = await import('@/lib/pipeline/engine');
      await advancePipelineAfterTask(taskId, output);
    } catch (pipelineErr) {
      await hermesLog(
        'warn',
        `Pipeline hand-off error: ${String(pipelineErr).replace(/\s+/g, ' ').slice(0, 120)}`,
        agentId
      );
    }

    // Tool gate — UP/DOWN lanes may act on their own output. One bounded
    // sandbox pass (allowlisted commands, confined FS); results stream to the
    // logs table. A full react-loop would re-invoke the model with the
    // formatted feedback; kept single-pass here to stay inside the serverless
    // wall-clock budget.
    if ((input.lane === 'UP' || input.lane === 'DOWN')) {
      const { calls } = parseToolCalls(output);
      if (calls.length > 0) {
        await hermesLog('info', `${persona.label} tool pass: ${calls.length} call(s)`, agentId);
        await executeToolCalls(taskId, calls);
      }
    }
  } catch (err) {
    const line = String(err).replace(/\s+/g, ' ').slice(0, 200);
    await Promise.all([
      db.from('tasks').update({ status: 'failed' }).eq('id', taskId),
      db.from('agents').update({ status: 'error', current_task_id: null }).eq('id', agentId),
      recordModelEvent({ model, event: 'HALT', taskId, agentId, detail: line }),
    ]);
    await hermesLog('error', `${persona.label} failed: ${line.slice(0, 120)}`, agentId);
  }
}

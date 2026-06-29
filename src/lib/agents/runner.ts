import Anthropic from '@anthropic-ai/sdk';
import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { writeMemory } from '@/lib/hermes/memory-service';
import type { AgentType } from '@/lib/types/database.types';

export interface AgentWorkerInput {
  taskId: string;
  agentId: string;
  agentType: AgentType;
  description: string;
}

// claude-haiku-4-5: 1–3s per call — fits Vercel Hobby 10s limit.
const MODEL = 'claude-haiku-4-5';

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

export async function runAgentWorker(input: AgentWorkerInput): Promise<void> {
  const { taskId, agentId, agentType, description } = input;
  const persona = PERSONAS[agentType] ?? PERSONAS.generic;

  await hermesLog(
    'info',
    `${persona.label} executing: "${description.slice(0, 80)}${description.length > 80 ? '…' : ''}"`,
    agentId
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getAdminClient() as any;

  try {
    const msg = await getAnthropic().messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: persona.system,
      messages: [{ role: 'user', content: description }],
    });

    const output = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('\n')
      .trim();

    await Promise.all([
      db.from('tasks').update({ status: 'completed' }).eq('id', taskId),
      db.from('agents').update({ status: 'idle', current_task: null }).eq('id', agentId),
    ]);

    await hermesLog('success', `${persona.label} task complete (${output.length} chars)`, agentId);

    await writeMemory(`agent:${agentType}:last_output`, {
      taskId,
      description,
      preview: output.slice(0, 400),
      model: MODEL,
      completedAt: new Date().toISOString(),
    });
  } catch (err) {
    const errMsg = String(err);
    await Promise.all([
      db.from('tasks').update({ status: 'failed' }).eq('id', taskId),
      db.from('agents').update({ status: 'error', current_task: null }).eq('id', agentId),
    ]);
    await hermesLog('error', `${persona.label} failed: ${errMsg.slice(0, 120)}`, agentId);
  }
}

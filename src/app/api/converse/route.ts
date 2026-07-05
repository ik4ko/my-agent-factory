import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AgentRegistry } from '@/lib/agents/registry';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { publishBusEvent } from '@/lib/bus/system-bus';

/**
 * POST /api/converse — the Claude-CEO conversation loop.
 *
 * You (operator) talk → CLAUDE (CEO brain) answers directly and may delegate
 * real work to its two independent helpers, CODEX (engineering/quant) and
 * HERMES (research/recon). When it delegates, the helpers run concurrently on
 * their own brains, report back, and Claude synthesizes ONE spoken summary.
 * Every step is published to system_bus (agent.thought) so the dashboard's
 * AGENT ACTIVITY / terminal panels light up live. Auth-gated by middleware.
 */

const Schema = z.object({
  message: z.string().min(1).max(4000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) }))
    .max(20)
    .optional(),
});

const CEO_SYSTEM = `You are Claude, the CEO of "My Agent Factory". You speak with the operator by VOICE, so keep replies SHORT, natural and spoken-friendly (2-4 sentences, no markdown, no bullet lists, no code blocks).
You command two helpers, each an independent brain:
- Codex  — engineering & quantitative analysis (writes/reviews code, checks math, crunches data).
- Hermes — research & reconnaissance (gathers information, explores, summarizes findings).
Decide whether the operator's request needs a helper. Reply with ONLY a JSON object and nothing else:
{"reply":"<what you say to the operator right now, spoken>","delegate":[{"to":"codex"|"hermes","task":"<one clear instruction>"}]}
Delegate ONLY when genuine work is required; for greetings, questions you can answer, or chat, return an empty delegate array. Never delegate more than 2 tasks.`;

const SYNTH_SYSTEM = `You are Claude, CEO of My Agent Factory. Your helpers just reported back. Give the operator ONE short spoken summary (2-4 sentences, no markdown) of what was found or done, in your own decisive voice as the boss.`;

interface Delegation { to: 'codex' | 'hermes'; task: string; }

function parseCeo(text: string): { reply: string; delegate: Delegation[] } {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j: any = JSON.parse(m ? m[0] : text);
    const reply = typeof j?.reply === 'string' ? j.reply.trim() : '';
    const delegate: Delegation[] = Array.isArray(j?.delegate)
      ? j.delegate
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((d: any) => d && (d.to === 'codex' || d.to === 'hermes') && typeof d.task === 'string')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((d: any) => ({ to: d.to, task: String(d.task) }))
          .slice(0, 2)
      : [];
    return { reply: reply || text.trim(), delegate };
  } catch {
    return { reply: text.trim(), delegate: [] };
  }
}

export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  const { message, history } = parsed.data;

  const historyText = (history ?? [])
    .map((h) => `${h.role === 'user' ? 'Operator' : 'Claude'}: ${h.content}`)
    .join('\n');
  const ceoPrompt = `${historyText ? historyText + '\n' : ''}Operator: ${message}`;

  try {
    await publishBusEvent({ topic: 'agent.thought', agent: 'Claude', payload: { role: 'CEO', heard: message.slice(0, 200) } });

    const ceo = await AgentRegistry.CLAUDE.think({ system: CEO_SYSTEM, prompt: ceoPrompt, maxTokens: 700 });
    const { reply, delegate } = parseCeo(ceo.text);
    await hermesLog('info', `[CONVERSE] Claude(CEO ${ceo.provider}:${ceo.model}) → ${delegate.length} delegation(s)`);

    if (delegate.length === 0) {
      await publishBusEvent({ topic: 'agent.thought', agent: 'Claude', payload: { role: 'CEO', reply: reply.slice(0, 300) } });
      return NextResponse.json({
        reply,
        delegations: [],
        brain: { name: 'Claude', provider: ceo.provider, model: ceo.model },
      });
    }

    const results = await Promise.all(
      delegate.map(async (d) => {
        const brain = d.to === 'codex' ? AgentRegistry.CODEX : AgentRegistry.HERMES;
        const label = d.to === 'codex' ? 'Codex' : 'Hermes';
        try {
          const r = await brain.think({
            system: `You are ${label}, an independent specialist helper in an agent factory. Execute the task precisely and report back concisely in plain text (no markdown).`,
            prompt: d.task,
            maxTokens: 900,
          });
          await hermesLog('success', `[CONVERSE] ${label}(${r.provider}:${r.model}) reported back`);
          await publishBusEvent({ topic: 'agent.thought', agent: label, payload: { task: d.task.slice(0, 160), output: r.text.slice(0, 300) } });
          return { agent: label, task: d.task, output: r.text, provider: r.provider, model: r.model };
        } catch (e) {
          const msg = String(e).replace(/\s+/g, ' ').slice(0, 120);
          await hermesLog('error', `[CONVERSE] ${label} failed — ${msg}`);
          return { agent: label, task: d.task, output: `(failed: ${msg})`, provider: '', model: '' };
        }
      }),
    );

    const brief = results.map((r) => `${r.agent} was asked: "${r.task}"\n${r.agent} reported: ${r.output}`).join('\n\n');
    const synth = await AgentRegistry.CLAUDE.think({
      system: SYNTH_SYSTEM,
      prompt: `Operator asked: "${message}"\n\n${brief}\n\nYour spoken summary:`,
      maxTokens: 500,
    });
    const finalReply = synth.text.trim() || reply;
    await publishBusEvent({ topic: 'agent.thought', agent: 'Claude', payload: { role: 'CEO', reply: finalReply.slice(0, 300) } });

    return NextResponse.json({
      reply: finalReply,
      preamble: reply,
      delegations: results.map((r) => ({ agent: r.agent, task: r.task, provider: r.provider, model: r.model })),
      brain: { name: 'Claude', provider: ceo.provider, model: ceo.model },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'converse failed' }, { status: 500 });
  }
}

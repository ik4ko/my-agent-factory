import { NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';
import { AgentRegistry } from '@/lib/agents/registry';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { publishBusEvent } from '@/lib/bus/system-bus';
import { sendEmail } from '@/lib/comms/email';
import { readChatHistory, writeChatHistory, type ChatHistoryScope, type ChatHistoryTurn } from '@/lib/chat/history';
import { CeoReplyStreamer } from '@/lib/chat/reply-stream';
import { getSpendSnapshotSince, recordModelEvent } from '@/lib/telemetry/token-ledger';
import { estimateModelCostUsd } from '@/lib/telemetry/pricing';
import {
  classifyTradingCommand,
  executeDirectOperatorOrder,
  prepareAutonomousTradePulse,
  runAutonomousTradePulse,
} from '@/lib/trading/autonomy';
import type { ThinkResult } from '@/lib/agents/types';

/**
 * POST /api/converse — the Claude-CEO conversation loop.
 *
 * You (operator) talk → CLAUDE (CEO brain) answers directly and may delegate
 * real work to CODEX (engineering/quant). Future brains stay visually present
 * but do not spend tokens until explicitly wired. When Claude delegates, Codex
 * reports back and Claude synthesizes ONE spoken summary.
 * Every step is published to system_bus (agent.thought) so the dashboard's
 * AGENT ACTIVITY / terminal panels light up live. Auth-gated by middleware.
 */

const Schema = z.object({
  message: z.string().min(1).max(4000),
  scope: z.enum(['hub', 'trading', 'coding', 'personal', 'ceo', 'matrix']).optional().default('hub'),
  persona: z
    .enum(['architect', 'trading', 'coding', 'business_mentor', 'life_mentor', 'focus_mentor'])
    .optional()
    .default('architect'),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) }))
    .max(20)
    .optional(),
});

const CEO_SYSTEM = `You are Claude, the CEO of "My Agent Factory". You speak with the operator by VOICE, so keep replies SHORT, natural and spoken-friendly (2-4 sentences, no markdown, no bullet lists, no code blocks).
You command one helper brain:
- Codex  — engineering & quantitative analysis (writes/reviews code, checks math, crunches data).
Decide whether the operator's request needs a helper. Reply with ONLY a JSON object and nothing else:
{"reply":"<what you say to the operator right now, spoken>","delegate":[{"to":"codex","task":"<one clear instruction>"}]}
Delegate ONLY when genuine work is required; for greetings, questions you can answer, or chat, return an empty delegate array. Never delegate more than 1 task.
You can also SEND AN EMAIL from the operator's own Gmail when they clearly ask you to email someone. To send, add an "email" field:
{"reply":"...","delegate":[...],"email":{"to":"address@example.com","subject":"...","body":"..."}}
Include "email" ONLY when the operator explicitly asks to send/email someone (use the address they give you); otherwise omit it entirely. When you do send, say so in your spoken reply.`;

const PERSONA_APPENDIX: Record<string, string> = {
  architect:
    'You and Codex are the two main brain architects. Prefer low-cost, high-leverage moves and delegate only when useful.',
  trading:
    'You are in the Trading Room. Ordinary analysis stays clear about stale data and risk. Explicit execution commands are handled by the deterministic trading-autonomy gate before you speak; never invent broker execution in normal conversation.',
  coding:
    'You are in the Coding Room. Think like a product-minded engineering lead. Give implementation direction, review tradeoffs, and hand concrete coding work to Codex when needed.',
  business_mentor:
    'You are a direct business mentor: practical, strategic, financially grounded, and focused on decisions, customers, leverage, and execution.',
  life_mentor:
    'You are a steady life mentor: emotionally intelligent, honest, motivating, and focused on habits, relationships, energy, and judgment.',
  focus_mentor:
    'You are a focus mentor: concise, calm, and action-oriented. Help the operator pick the next move and reduce noise.',
};

const SYNTH_SYSTEM = `You are Claude, CEO of My Agent Factory. Your helpers just reported back. Give the operator ONE short spoken summary (2-4 sentences, no markdown) of what was found or done, in your own decisive voice as the boss.`;

const CONVERSE_MONTHLY_BUDGET_DEFAULT_USD = 3.0;

interface Delegation { to: 'codex'; task: string; }
interface EmailAction { to: string; subject: string; body: string; }
interface BudgetState {
  budgetUsd: number;
  spentUsd: number;
  remainingUsd: number;
}

function nonNegativeUsdEnv(name: string): number | null {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function converseBudgetUsd(): number {
  return (
    nonNegativeUsdEnv('CONVERSE_MONTHLY_BUDGET_USD') ??
    nonNegativeUsdEnv('ANTHROPIC_MONTHLY_BUDGET_USD') ??
    CONVERSE_MONTHLY_BUDGET_DEFAULT_USD
  );
}

function currentUtcMonthStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function usd(value: number): string {
  return `$${value.toFixed(2)}`;
}

async function readConverseBudgetState(): Promise<BudgetState> {
  const budgetUsd = converseBudgetUsd();
  const snapshot = await getSpendSnapshotSince(currentUtcMonthStartIso());
  const spentUsd = snapshot.totalCostUsd ?? 0;
  return { budgetUsd, spentUsd, remainingUsd: Math.max(0, budgetUsd - spentUsd) };
}

async function persistCeoHistory(
  history: Array<{ role: 'user' | 'assistant'; content: string }> | undefined,
  message: string,
  reply: string,
  scope: ChatHistoryScope,
  model?: string,
  error = false,
): Promise<ChatHistoryTurn[]> {
  const current = history ?? (await readChatHistory(scope));
  return writeChatHistory(scope, [
    ...current,
    { role: 'user', content: message },
    { role: 'assistant', content: reply, agentId: 'CEO', ...(model ? { model } : {}), ...(error ? { error: true } : {}) },
  ]);
}

async function budgetBlockResponse({
  stage,
  reason,
  scope,
  message,
  history,
  budget,
}: {
  stage: string;
  reason: string;
  scope: ChatHistoryScope;
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }> | undefined;
  budget?: BudgetState;
}): Promise<NextResponse> {
  await hermesLog('warn', `[CONVERSE] ${stage} blocked — ${reason}`);
  await recordModelEvent({
    model: 'converse-budget-gate',
    event: 'HALT',
    detail: `converse:${stage} ${reason}`,
  });

  let savedHistory: ChatHistoryTurn[] | undefined;
  try {
    savedHistory = await persistCeoHistory(history, message, reason, scope, 'budget-gate', true);
  } catch (err) {
    await hermesLog('error', `[CONVERSE] failed to persist budget block — ${err instanceof Error ? err.message : 'unknown error'}`);
  }

  return NextResponse.json(
    {
      error: reason,
      ...(savedHistory ? { history: savedHistory } : {}),
      ...(budget
        ? {
            budget: {
              spentUsd: budget.spentUsd,
              budgetUsd: budget.budgetUsd,
              remainingUsd: budget.remainingUsd,
            },
          }
        : {}),
    },
    { status: 402 },
  );
}

async function guardConverseBudget({
  stage,
  scope,
  message,
  history,
}: {
  stage: string;
  scope: ChatHistoryScope;
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }> | undefined;
}): Promise<NextResponse | null> {
  let budget: BudgetState;
  try {
    budget = await readConverseBudgetState();
  } catch (err) {
    return budgetBlockResponse({
      stage,
      scope,
      message,
      history,
      reason: `Converse budget check failed closed: ${err instanceof Error ? err.message : 'ledger unavailable'}`,
    });
  }

  if (budget.spentUsd >= budget.budgetUsd) {
    return budgetBlockResponse({
      stage,
      scope,
      message,
      history,
      budget,
      reason: `Converse monthly budget exceeded: ${usd(budget.spentUsd)} ≥ ${usd(budget.budgetUsd)} cap (CONVERSE_MONTHLY_BUDGET_USD)`,
    });
  }
  return null;
}

async function recordConverseUsage(stage: string, scope: ChatHistoryScope, result: ThinkResult): Promise<void> {
  const costUsd = estimateModelCostUsd(result.model, result.inputTokens, result.outputTokens);
  await recordModelEvent({
    model: result.model,
    event: 'USAGE',
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    detail: [
      `converse:${stage}`,
      `scope=${scope}`,
      `provider=${result.provider}`,
      `latency=${result.latencyMs}ms`,
      `est_usd=${costUsd.toFixed(6)}`,
    ].join(' · '),
  });
}

function parseCeo(text: string): { reply: string; delegate: Delegation[]; email: EmailAction | null } {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j: any = JSON.parse(m ? m[0] : text);
    const reply = typeof j?.reply === 'string' ? j.reply.trim() : '';
    const delegate: Delegation[] = Array.isArray(j?.delegate)
      ? j.delegate
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((d: any) => d && d.to === 'codex' && typeof d.task === 'string')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((d: any) => ({ to: d.to, task: String(d.task) }))
          .slice(0, 1)
      : [];
    const email: EmailAction | null =
      j?.email && typeof j.email.to === 'string'
        ? { to: String(j.email.to), subject: String(j.email.subject ?? ''), body: String(j.email.body ?? '') }
        : null;
    return { reply: reply || text.trim(), delegate, email };
  } catch {
    return { reply: text.trim(), delegate: [], email: null };
  }
}

export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  const { message, history, scope, persona } = parsed.data;

  if (scope === 'trading' || persona === 'trading') {
    const tradingCommand = classifyTradingCommand(message);
    if (tradingCommand.kind === 'unsupported') {
      const savedHistory = await persistCeoHistory(history, message, tradingCommand.reason, scope, 'trading-autonomy', true);
      return NextResponse.json({
        reply: tradingCommand.reason,
        delegations: [],
        brain: { name: 'Trading Autonomy', model: 'deterministic-gate' },
        history: savedHistory,
      });
    }
    if (tradingCommand.kind === 'pulse') {
      const pulse = await prepareAutonomousTradePulse(tradingCommand.reason);
      if (pulse.accepted) {
        after(async () => {
          await runAutonomousTradePulse(pulse.loops, tradingCommand.reason);
        });
      }
      const savedHistory = await persistCeoHistory(
        history,
        message,
        pulse.reply,
        scope,
        pulse.accepted ? 'trading-autonomy' : 'mandate-not-armed',
        !pulse.accepted,
      );
      return NextResponse.json({
        reply: pulse.reply,
        delegations: [],
        brain: { name: 'Trading Autonomy', model: 'mandate-pulse' },
        history: savedHistory,
      });
    }
    if (tradingCommand.kind === 'direct_order') {
      const execution = await executeDirectOperatorOrder(tradingCommand);
      const savedHistory = await persistCeoHistory(
        history,
        message,
        execution.reply,
        scope,
        execution.result?.status ?? (execution.blocked ? 'risk-blocked' : 'trading-autonomy'),
        Boolean(execution.blocked),
      );
      return NextResponse.json({
        reply: execution.reply,
        delegations: [],
        order: execution.order,
        brain: { name: 'Trading Autonomy', model: execution.adapter },
        history: savedHistory,
      });
    }
  }

  const historyText = (history ?? [])
    .slice(-8)
    .map((h) => `${h.role === 'user' ? 'Operator' : 'Claude'}: ${h.content}`)
    .join('\n');
  const ceoPrompt = `${historyText ? historyText + '\n' : ''}Operator: ${message}`;

  try {
    // Bus event is observability, not a precondition — never serialize on it.
    void publishBusEvent({ topic: 'agent.thought', agent: 'Claude', payload: { role: 'CEO', heard: message.slice(0, 200) } }).catch(() => undefined);

    const ceoBudgetBlock = await guardConverseBudget({ stage: 'ceo', scope, message, history });
    if (ceoBudgetBlock) return ceoBudgetBlock;

    // Overlap the history read (only needed for post-reply persistence) with
    // the CEO model call instead of paying for it afterwards.
    const historyPromise: Promise<Array<{ role: 'user' | 'assistant'; content: string }> | undefined> = history
      ? Promise.resolve(history)
      : readChatHistory(scope).catch(() => undefined);

    const ceoSystem = `${CEO_SYSTEM}\n\n${PERSONA_APPENDIX[persona]}`;

    // ?stream=1 → SSE deltas of the CEO's visible reply text, then a `done`
    // event carrying the exact payload the JSON mode returns. Early exits
    // above (trading gate, budget block, bad payload) always answer as JSON —
    // the client branches on content-type. Non-streaming stays the default.
    if (req.nextUrl.searchParams.get('stream') === '1') {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: Record<string, unknown>) =>
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          try {
            const streamer = new CeoReplyStreamer();
            const ceo = await AgentRegistry.CLAUDE.think({
              system: ceoSystem,
              prompt: ceoPrompt,
              maxTokens: 700,
              ledger: { mode: 'external' },
              liveTools: true,
              onDelta: (delta) => {
                const visible = streamer.push(delta);
                if (visible) send({ type: 'delta', text: visible });
              },
            });
            const tail = streamer.flush();
            if (tail) send({ type: 'delta', text: tail });
            // The done payload is AUTHORITATIVE (parseCeo over the full text);
            // the streamed preview above is presentation-only and the client
            // reconciles to this on receipt.
            const payload = await completeCeoTurn({ ceo, message, scope, historyPromise });
            send({ type: 'done', ...payload });
          } catch (err) {
            send({ type: 'error', error: err instanceof Error ? err.message : 'converse failed' });
          } finally {
            controller.close();
          }
        },
      });
      return new Response(body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        },
      });
    }

    const ceo = await AgentRegistry.CLAUDE.think({
      system: ceoSystem,
      prompt: ceoPrompt,
      maxTokens: 700,
      ledger: { mode: 'external' },
      liveTools: true,
    });
    const payload = await completeCeoTurn({ ceo, message, scope, historyPromise });
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'converse failed' }, { status: 500 });
  }
}

/** Schedule background work: after() inside a live request scope, otherwise
 *  (e.g. an SSE stream body that outlives the request store) plain
 *  fire-and-forget — this host runs a long-lived node process, so the task
 *  still completes; only serverless teardown could drop it. */
function defer(task: () => Promise<unknown>): void {
  const run = () => task().catch(() => undefined);
  try {
    after(run);
  } catch {
    void run();
  }
}

/** Everything that happens after the CEO model call, shared verbatim by the
 *  JSON and SSE modes: parse, optional email, persist the immediate reply,
 *  schedule background delegation, and shape the response payload. */
async function completeCeoTurn({
  ceo,
  message,
  scope,
  historyPromise,
}: {
  ceo: ThinkResult;
  message: string;
  scope: ChatHistoryScope;
  historyPromise: Promise<Array<{ role: 'user' | 'assistant'; content: string }> | undefined>;
}) {
  defer(() => recordConverseUsage('ceo', scope, ceo));
  const { reply, delegate, email } = parseCeo(ceo.text);
  void hermesLog('info', `[CONVERSE] Claude(CEO ${ceo.provider}:${ceo.model}) → ${delegate.length} delegation(s)${email ? ' + email' : ''}`).catch(() => undefined);

  // If Claude decided to send an email, do it now (autonomous send + audit).
  let emailNote = '';
  if (email) {
    const r = await sendEmail({ to: email.to, subject: email.subject, body: email.body, agent: 'Claude' });
    emailNote = r.ok
      ? r.staged
        ? ` (email to ${email.to} staged for approval)`
        : ` (email sent to ${email.to})`
      : ` (email to ${email.to} failed: ${r.error})`;
  }

  // Speak the CEO's direct reply NOW — with delegations, the operator no
  // longer waits for helper + synthesis round-trips (they run in the
  // background below and land in this scope's history when done).
  const finalReply = reply + emailNote;
  const savedHistory = await persistCeoHistory(await historyPromise, message, finalReply, scope, ceo.model);
  void publishBusEvent({ topic: 'agent.thought', agent: 'Claude', payload: { role: 'CEO', reply: finalReply.slice(0, 300) } }).catch(() => undefined);

  if (delegate.length > 0) {
    defer(() => runDelegationsInBackground({ delegate, message, ceoReply: reply, scope }));
  }

  return {
    reply: finalReply,
    delegations: delegate.map((d) => ({ agent: 'Codex', task: d.task, status: 'running' })),
    emailed: email ? email.to : null,
    brain: { name: 'Claude', provider: ceo.provider, model: ceo.model },
    history: savedHistory,
  };
}

/**
 * Background half of a delegated converse turn (scheduled via after(), so it
 * survives the response on both node and Vercel runtimes). Runs the helper
 * calls + synthesis that used to block the reply, then APPENDS the synthesis
 * as a fresh assistant turn — re-reading the scope history at write time so a
 * message the operator sent meanwhile isn't clobbered. Budget gates still
 * apply; a block becomes an error turn in history instead of a 402.
 */
async function runDelegationsInBackground({
  delegate,
  message,
  ceoReply,
  scope,
}: {
  delegate: Array<{ to: string; task: string }>;
  message: string;
  ceoReply: string;
  scope: ChatHistoryScope;
}): Promise<void> {
  const appendTurn = async (content: string, model: string, error = false) => {
    const current = await readChatHistory(scope);
    await writeChatHistory(scope, [
      ...current,
      { role: 'assistant', content, agentId: 'CEO', model, ...(error ? { error: true } : {}) },
    ]);
  };

  try {
    const gate = await readConverseBudgetState();
    if (gate.spentUsd >= gate.budgetUsd) {
      const reason = `Delegation skipped — converse monthly budget exceeded: ${usd(gate.spentUsd)} ≥ ${usd(gate.budgetUsd)} cap`;
      await hermesLog('warn', `[CONVERSE] background codex blocked — ${reason}`);
      await appendTurn(reason, 'budget-gate', true);
      return;
    }

    const results = await Promise.all(
      delegate.map(async (d) => {
        const brain = AgentRegistry.CODEX;
        const label = 'Codex';
        try {
          const r = await brain.think({
            system: `You are ${label}, an independent specialist helper in an agent factory. Execute the task precisely and report back concisely in plain text (no markdown).`,
            prompt: d.task,
            maxTokens: 900,
            ledger: { mode: 'external' },
            // Delegated tasks can look up real data before the CEO synthesis.
            liveTools: true,
          });
          await recordConverseUsage('codex', scope, r);
          void hermesLog('success', `[CONVERSE] ${label}(${r.provider}:${r.model}) reported back`).catch(() => undefined);
          void publishBusEvent({ topic: 'agent.thought', agent: label, payload: { task: d.task.slice(0, 160), output: r.text.slice(0, 300) } }).catch(() => undefined);
          return { agent: label, task: d.task, output: r.text };
        } catch (e) {
          const msg = String(e).replace(/\s+/g, ' ').slice(0, 120);
          await hermesLog('error', `[CONVERSE] ${label} failed — ${msg}`);
          return { agent: label, task: d.task, output: `(failed: ${msg})` };
        }
      }),
    );

    const brief = results.map((r) => `${r.agent} was asked: "${r.task}"\n${r.agent} reported: ${r.output}`).join('\n\n');
    const synthGate = await readConverseBudgetState();
    if (synthGate.spentUsd >= synthGate.budgetUsd) {
      // Helpers already ran — surface their raw reports rather than losing them.
      await appendTurn(`Helper reports (summary skipped, budget cap reached):\n\n${brief}`, 'budget-gate', true);
      return;
    }

    const synth = await AgentRegistry.CLAUDE.think({
      system: SYNTH_SYSTEM,
      prompt: `Operator asked: "${message}"\n\n${brief}\n\nYour spoken summary:`,
      maxTokens: 500,
      ledger: { mode: 'external' },
    });
    await recordConverseUsage('synth', scope, synth);
    const summary = synth.text.trim() || ceoReply;
    await appendTurn(summary, synth.model);
    void publishBusEvent({ topic: 'agent.thought', agent: 'Claude', payload: { role: 'CEO', reply: summary.slice(0, 300) } }).catch(() => undefined);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'background delegation failed';
    await hermesLog('error', `[CONVERSE] background delegation failed — ${msg}`);
    try {
      await appendTurn(`(delegation failed: ${msg.slice(0, 160)})`, 'background-error', true);
    } catch {
      // History append is best-effort; the hermes log above is the audit trail.
    }
  }
}

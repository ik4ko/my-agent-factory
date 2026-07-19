import { executeLiveTool, parseToolArgs } from '@/lib/tools/live-tools';
import type { OpenAICompatibleStreamResult } from './openai-compatible-stream';

/**
 * Shared tool-call loop for every OpenAI-compatible chat backend
 * (OpenRouter, local servers, NVIDIA): call the model, and while it answers
 * with finish_reason=tool_calls, execute the requested live tools, append
 * the assistant tool_calls turn + tool results, and call again. Bounded
 * rounds; a tool failure feeds an error string back to the model (see
 * live-tools.ts) so the turn always ends in a text reply.
 */

export interface ToolLoopOutcome {
  text: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  toolRounds: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ChatMessage = Record<string, any>;

/** One round of an OpenAI RESPONSES API exchange, as the loop sees it. */
export interface ResponsesRound {
  /** response.output verbatim — reasoning + function_call items included,
   *  because reasoning models require their own items echoed back. */
  outputItems: ChatMessage[];
  text: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  status?: string;
  incompleteReason?: string;
}

export interface ResponsesLoopOutcome extends ToolLoopOutcome {
  status?: string;
  incompleteReason?: string;
}

/** Tool loop for the OpenAI Responses API (the openai-direct CODEX lane) —
 *  same contract as runToolCallRounds, adapted to the Responses wire shape:
 *  function_call output items answered with function_call_output items. */
export async function runResponsesToolRounds(opts: {
  input: ChatMessage[];
  callModel: (input: ChatMessage[]) => Promise<ResponsesRound>;
  maxRounds?: number;
}): Promise<ResponsesLoopOutcome> {
  let input = [...opts.input];
  const maxRounds = opts.maxRounds ?? 4;
  const texts: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let model: string | undefined;
  let toolRounds = 0;
  let status: string | undefined;
  let incompleteReason: string | undefined;

  for (let round = 0; round < maxRounds; round++) {
    const result = await opts.callModel(input);
    inputTokens += result.inputTokens;
    outputTokens += result.outputTokens;
    model = result.model ?? model;
    status = result.status;
    incompleteReason = result.incompleteReason;
    if (result.text) texts.push(result.text);

    const calls = result.outputItems.filter((item) => item.type === 'function_call' && item.name);
    if (calls.length === 0) break;
    toolRounds += 1;

    const outputs = await Promise.all(
      calls.map(async (call) => ({
        type: 'function_call_output',
        call_id: call.call_id,
        output: await executeLiveTool(String(call.name), parseToolArgs(call.arguments)),
      })),
    );
    input = [...input, ...result.outputItems, ...outputs];
  }

  return { text: texts.join('\n\n'), model, inputTokens, outputTokens, toolRounds, status, incompleteReason };
}

export async function runToolCallRounds(opts: {
  messages: ChatMessage[];
  callModel: (messages: ChatMessage[]) => Promise<OpenAICompatibleStreamResult>;
  maxRounds?: number;
}): Promise<ToolLoopOutcome> {
  const messages = [...opts.messages];
  const maxRounds = opts.maxRounds ?? 4;
  const texts: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let model: string | undefined;
  let toolRounds = 0;

  for (let round = 0; round < maxRounds; round++) {
    const streamed = await opts.callModel(messages);
    inputTokens += streamed.inputTokens;
    outputTokens += streamed.outputTokens;
    model = streamed.model ?? model;
    if (streamed.text) texts.push(streamed.text);

    const calls = streamed.finishReason === 'tool_calls' ? streamed.toolCalls.filter((c) => c.name) : [];
    if (calls.length === 0) break;
    toolRounds += 1;

    // Providers occasionally omit ids on streamed fragments — synthesize
    // stable ones so the tool_result linkage is always well-formed.
    const withIds = calls.map((c, i) => ({ ...c, id: c.id || `call_r${round}_${i}` }));
    messages.push({
      role: 'assistant',
      content: streamed.text || null,
      tool_calls: withIds.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.argsJson || '{}' } })),
    });
    const results = await Promise.all(
      withIds.map(async (c) => ({ id: c.id, content: await executeLiveTool(c.name, parseToolArgs(c.argsJson)) })),
    );
    messages.push(...results.map((r) => ({ role: 'tool', tool_call_id: r.id, content: r.content })));
  }

  return { text: texts.join('\n\n'), model, inputTokens, outputTokens, toolRounds };
}

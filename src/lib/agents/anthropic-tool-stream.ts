import type Anthropic from '@anthropic-ai/sdk';
import { executeLiveTool, parseToolArgs, toAnthropicTools } from '@/lib/tools/live-tools';

/**
 * The ONE Anthropic streaming tool loop, shared by the registry's
 * anthropicThink (CEO/converse lane) and the dispatcher's anthropic-direct
 * streaming branch: stream each turn, assemble tool_use blocks from
 * input_json_delta fragments, execute via the shared live-tools layer, feed
 * tool_result back, repeat until the model answers in text (bounded rounds).
 */

export interface AnthropicStreamOutcome {
  text: string;
  /** API-reported model id from message_start (falls back to the request model). */
  model: string;
  /** UNCACHED prompt tokens. Cache traffic is reported separately below. */
  inputTokens: number;
  outputTokens: number;
  /** `cache_creation_input_tokens` — prompt prefix written to cache (1.25x input). */
  cacheWriteTokens: number;
  /** `cache_read_input_tokens` — prefix served from cache (0.1x input). The
   *  signal that caching is actually working; zero across repeated turns means
   *  something upstream is invalidating the prefix. */
  cacheReadTokens: number;
  toolRounds: number;
  modelRoundMs: number[];
  toolCalls: Array<{ name: string; latencyMs: number }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMessage = any;

export async function runAnthropicToolStream(opts: {
  client: Anthropic;
  model: string;
  system: string;
  messages: AnyMessage[];
  maxTokens: number;
  liveTools?: boolean;
  /** Dispatcher lanes disable extended thinking for parity + predictable cost. */
  disableThinking?: boolean;
  onDelta?: (text: string) => void;
  maxRounds?: number;
}): Promise<AnthropicStreamOutcome> {
  const tools = opts.liveTools ? toAnthropicTools() : undefined;
  const messages: AnyMessage[] = [...opts.messages];
  let text = '';
  let reportedModel = opts.model;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheWriteTokens = 0;
  let cacheReadTokens = 0;
  let toolRounds = 0;
  const modelRoundMs: number[] = [];
  const toolCalls: Array<{ name: string; latencyMs: number }> = [];

  for (let round = 0; round < (opts.maxRounds ?? 4); round++) {
    const modelStarted = performance.now();
    const stream = await opts.client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens,
      // Anthropic's automatic five-minute prompt cache reuses the stable
      // tools -> system -> history prefix across turns and within tool loops.
      cache_control: { type: 'ephemeral' },
      system: opts.system,
      messages,
      ...(tools ? { tools } : {}),
      ...(opts.disableThinking ? { thinking: { type: 'disabled' as const } } : {}),
      stream: true,
    });

    const toolUses: Array<{ id: string; name: string; argsJson: string }> = [];
    let stopReason: string | null = null;
    let roundText = '';

    for await (const event of stream) {
      if (event.type === 'message_start') {
        inputTokens += event.message.usage?.input_tokens ?? 0;
        cacheWriteTokens += event.message.usage?.cache_creation_input_tokens ?? 0;
        cacheReadTokens += event.message.usage?.cache_read_input_tokens ?? 0;
        reportedModel = event.message.model ?? reportedModel;
      } else if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        toolUses.push({ id: event.content_block.id, name: event.content_block.name, argsJson: '' });
      } else if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') {
        const current = toolUses[toolUses.length - 1];
        if (current) current.argsJson += event.delta.partial_json;
      } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        roundText += event.delta.text;
        text += event.delta.text;
        opts.onDelta?.(event.delta.text);
      } else if (event.type === 'message_delta') {
        outputTokens += event.usage?.output_tokens ?? 0;
        stopReason = event.delta.stop_reason ?? stopReason;
      }
    }
    modelRoundMs.push(Math.round(performance.now() - modelStarted));

    if (stopReason !== 'tool_use' || toolUses.length === 0) break;
    toolRounds += 1;

    const results = await Promise.all(toolUses.map(async (t) => {
      const toolStarted = performance.now();
      const output = await executeLiveTool(t.name, parseToolArgs(t.argsJson));
      toolCalls.push({ name: t.name, latencyMs: Math.round(performance.now() - toolStarted) });
      return { id: t.id, output };
    }));
    messages.push({
      role: 'assistant',
      content: [
        ...(roundText ? [{ type: 'text', text: roundText }] : []),
        ...toolUses.map((t) => ({ type: 'tool_use', id: t.id, name: t.name, input: parseToolArgs(t.argsJson) })),
      ],
    });
    messages.push({
      role: 'user',
      content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.output })),
    });
  }

  return { text, model: reportedModel, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, toolRounds, modelRoundMs, toolCalls };
}

export interface StreamedToolCall {
  id: string;
  name: string;
  /** Raw JSON argument string, accumulated across delta fragments. */
  argsJson: string;
}

export interface OpenAICompatibleStreamResult {
  text: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  /** Present when the model requested tool calls (finish_reason tool_calls). */
  toolCalls: StreamedToolCall[];
  finishReason?: string;
}

/** Consume the OpenAI-compatible SSE dialect used by OpenRouter, local
 * servers, and NVIDIA. Unknown events are ignored; [DONE] terminates. */
export async function consumeOpenAICompatibleStream(
  body: ReadableStream<Uint8Array>,
  onDelta?: (delta: string) => void,
): Promise<OpenAICompatibleStreamResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let model: string | undefined;
  let inputTokens = 0;
  let outputTokens = 0;
  let finishReason: string | undefined;
  // tool_call fragments arrive with an index; name comes once, arguments in pieces.
  const toolCallsByIndex = new Map<number, StreamedToolCall>();

  const consumeFrame = (frame: string): boolean => {
    for (const line of frame.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return true;
      try {
        const event = JSON.parse(payload) as {
          model?: string;
          choices?: Array<{
            delta?: {
              content?: string;
              tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
            };
            finish_reason?: string | null;
          }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        model = event.model ?? model;
        inputTokens = event.usage?.prompt_tokens ?? inputTokens;
        outputTokens = event.usage?.completion_tokens ?? outputTokens;
        const choice = event.choices?.[0];
        finishReason = choice?.finish_reason ?? finishReason;
        const delta = choice?.delta?.content;
        if (typeof delta === 'string' && delta) {
          text += delta;
          onDelta?.(delta);
        }
        for (const fragment of choice?.delta?.tool_calls ?? []) {
          const index = fragment.index ?? 0;
          const entry = toolCallsByIndex.get(index) ?? { id: '', name: '', argsJson: '' };
          if (fragment.id) entry.id = fragment.id;
          if (fragment.function?.name) entry.name += fragment.function.name;
          if (fragment.function?.arguments) entry.argsJson += fragment.function.arguments;
          toolCallsByIndex.set(index, entry);
        }
      } catch {
        // A malformed provider event must not corrupt adjacent valid frames.
      }
    }
    return false;
  };

  let done = false;
  while (!done) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      if (consumeFrame(frame)) { done = true; break; }
    }
  }
  buffer += decoder.decode();
  if (!done && buffer.trim()) consumeFrame(buffer);
  const toolCalls = [...toolCallsByIndex.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
  return { text, model, inputTokens, outputTokens, toolCalls, finishReason };
}

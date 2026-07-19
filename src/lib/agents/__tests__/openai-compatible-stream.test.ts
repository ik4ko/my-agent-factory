import { consumeOpenAICompatibleStream } from '../openai-compatible-stream';

function chunkedBody(text: string, chunkSize: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        controller.enqueue(bytes.slice(offset, offset + chunkSize));
      }
      controller.close();
    },
  });
}

const SSE = [
  'data: {"model":"stub-model","choices":[{"delta":{"content":"hello "}}]}',
  '',
  'data: {"choices":[{"delta":{"content":"world"}}]}',
  '',
  'data: {"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":2}}',
  '',
  'data: [DONE]',
  '',
].join('\n');

describe('consumeOpenAICompatibleStream', () => {
  it.each([1, 2, 7, 64, 4096])('reassembles SSE across byte chunk size %i', async (size) => {
    const deltas: string[] = [];
    const result = await consumeOpenAICompatibleStream(chunkedBody(SSE, size), (delta) => deltas.push(delta));
    // Contract grew for the live-tools loop (2026-07-19): the result now
    // reports toolCalls + finishReason. Still asserted exactly, not loosened.
    expect(result).toEqual({
      text: 'hello world',
      model: 'stub-model',
      inputTokens: 9,
      outputTokens: 2,
      toolCalls: [],
      finishReason: undefined,
    });
    expect(deltas).toEqual(['hello ', 'world']);
  });
});

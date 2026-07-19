import { runAnthropicToolStream } from '../anthropic-tool-stream';

describe('runAnthropicToolStream prompt caching', () => {
  it('enables Anthropic automatic ephemeral prefix caching', async () => {
    const create = jest.fn(async function* () {
      yield { type: 'message_start', message: { model: 'claude-test', usage: { input_tokens: 4 } } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'done' } };
      yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } };
    });
    const client = { messages: { create } };

    const outcome = await runAnthropicToolStream({
      // The production SDK shape is much larger; this focused fake exercises
      // the exact request contract without making a paid network call.
      client: client as never,
      model: 'claude-test',
      system: 'stable system prefix',
      messages: [{ role: 'user', content: 'hello' }],
      maxTokens: 16,
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ cache_control: { type: 'ephemeral' } }));
    expect(outcome.text).toBe('done');
  });
});

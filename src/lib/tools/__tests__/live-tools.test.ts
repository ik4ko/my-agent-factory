import http from 'http';
import type { AddressInfo } from 'net';
import { __setLiveToolForTest, executeLiveTool, parseToolArgs, toAnthropicTools, toOpenAITools, withToolTimeout } from '../live-tools';
import { runToolCallRounds } from '@/lib/agents/tool-loop';
import { AgentRegistry } from '@/lib/agents/registry';
import type { OpenAICompatibleStreamResult } from '@/lib/agents/openai-compatible-stream';

describe('live-tools — graceful degradation contract', () => {
  it('unknown tool returns a readable message, never throws', async () => {
    const out = await executeLiveTool('no_such_tool', {});
    expect(out).toContain('does not exist');
    expect(out).toContain('web_search');
  });

  it('web_search without TAVILY_API_KEY degrades to a not-configured message', async () => {
    const saved = process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_API_KEY;
    const out = await executeLiveTool('web_search', { query: 'latest news' });
    expect(out).toContain('not configured');
    if (saved !== undefined) process.env.TAVILY_API_KEY = saved;
  });

  it('a throwing tool degrades to an error string the model can read', async () => {
    const restore = __setLiveToolForTest({
      name: 'web_search',
      description: 'boom',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        throw new Error('upstream 503');
      },
    });
    try {
      const out = await executeLiveTool('web_search', { query: 'x' });
      expect(out).toContain('failed');
      expect(out).toContain('upstream 503');
    } finally {
      restore();
    }
  });

  it('exports both provider tool formats for the same registry', () => {
    const names = ['web_search', 'get_weather', 'get_stock_quote'];
    expect(toAnthropicTools().map((t) => t.name).sort()).toEqual([...names].sort());
    expect(toOpenAITools().map((t) => t.function.name).sort()).toEqual([...names].sort());
  });

  it('parseToolArgs tolerates strings, objects, and garbage', () => {
    expect(parseToolArgs('{"a":1}')).toEqual({ a: 1 });
    expect(parseToolArgs({ b: 2 })).toEqual({ b: 2 });
    expect(parseToolArgs('not json')).toEqual({});
    expect(parseToolArgs(undefined)).toEqual({});
  });

  it('bounds promise-only providers that cannot accept AbortSignal', async () => {
    jest.useFakeTimers();
    try {
      const pending = withToolTimeout(new Promise<never>(() => undefined), 'Yahoo quote', 25);
      const rejection = expect(pending).rejects.toThrow('Yahoo quote timed out after 25ms');
      await jest.advanceTimersByTimeAsync(25);
      await rejection;
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('runToolCallRounds — loop mechanics', () => {
  const finalResult = (text: string): OpenAICompatibleStreamResult => ({
    text,
    inputTokens: 5,
    outputTokens: 3,
    toolCalls: [],
    finishReason: 'stop',
  });

  it('executes requested tools, threads results, and returns the final text', async () => {
    const restore = __setLiveToolForTest({
      name: 'web_search',
      description: 'fake',
      inputSchema: { type: 'object', properties: {} },
      execute: async (args) => `FAKE RESULTS for ${String(args.query)}`,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const seenMessages: any[][] = [];
    let call = 0;
    try {
      const outcome = await runToolCallRounds({
        messages: [{ role: 'user', content: 'what happened today?' }],
        callModel: async (messages) => {
          seenMessages.push([...messages]);
          call += 1;
          if (call === 1) {
            return {
              text: '',
              inputTokens: 10,
              outputTokens: 4,
              finishReason: 'tool_calls',
              toolCalls: [{ id: 'call_1', name: 'web_search', argsJson: '{"query":"today news"}' }],
            };
          }
          return finalResult('Here is what happened.');
        },
      });
      expect(outcome.text).toBe('Here is what happened.');
      expect(outcome.toolRounds).toBe(1);
      expect(outcome.inputTokens).toBe(15);
      expect(outcome.outputTokens).toBe(7);
      // Second call must carry the assistant tool_calls turn + tool result.
      const second = seenMessages[1];
      expect(second.at(-2).role).toBe('assistant');
      expect(second.at(-2).tool_calls[0].function.name).toBe('web_search');
      expect(second.at(-1)).toEqual({ role: 'tool', tool_call_id: 'call_1', content: 'FAKE RESULTS for today news' });
    } finally {
      restore();
    }
  });

  it('bounds runaway tool loops at maxRounds', async () => {
    const restore = __setLiveToolForTest({
      name: 'web_search',
      description: 'fake',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => 'more',
    });
    let calls = 0;
    try {
      const outcome = await runToolCallRounds({
        messages: [{ role: 'user', content: 'loop forever' }],
        maxRounds: 3,
        callModel: async () => {
          calls += 1;
          return {
            text: '',
            inputTokens: 1,
            outputTokens: 1,
            finishReason: 'tool_calls',
            toolCalls: [{ id: `c${calls}`, name: 'web_search', argsJson: '{}' }],
          };
        },
      });
      expect(calls).toBe(3);
      expect(outcome.toolRounds).toBe(3);
    } finally {
      restore();
    }
  });
});

describe('end-to-end: registry lane calls a tool through a stub local server', () => {
  let server: http.Server;
  let baseUrl = '';
  let requestCount = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let secondRequestBody: any = null;
  const ENV_KEYS = ['AI_LOCAL_BASE_URL', 'AI_LOCAL_MODEL', 'OPENROUTER_API_KEY'] as const;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        requestCount += 1;
        res.setHeader('Content-Type', 'text/event-stream');
        if (requestCount === 1) {
          // Round 1: the model asks for the web_search tool.
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_x', function: { name: 'web_search', arguments: '{"query":' } }] } }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"nvda news"}' } }] }, finish_reason: 'tool_calls' }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 9, completion_tokens: 2 } })}\n\n`);
        } else {
          secondRequestBody = JSON.parse(raw);
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'NVDA had a big day.' }, finish_reason: null }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 6 } })}\n\n`);
        }
        res.end('data: [DONE]\n\n');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it('CODEX.think with liveTools runs the full request→tool→request→reply loop', async () => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.AI_LOCAL_BASE_URL = baseUrl;
    process.env.AI_LOCAL_MODEL = 'tool-test-model';
    const restore = __setLiveToolForTest({
      name: 'web_search',
      description: 'fake',
      inputSchema: { type: 'object', properties: {} },
      execute: async (args) => `STUB SEARCH: ${String(args.query)}`,
    });
    try {
      const result = await AgentRegistry.CODEX.think({
        system: 'test',
        prompt: 'what happened to NVDA?',
        liveTools: true,
        ledger: { mode: 'off' },
      });
      expect(result.text).toBe('NVDA had a big day.');
      expect(result.inputTokens).toBe(29);
      expect(result.outputTokens).toBe(8);
      // The second request must include the tool exchange on the wire.
      const roles = secondRequestBody.messages.map((m: { role: string }) => m.role);
      expect(roles).toEqual(['system', 'user', 'assistant', 'tool']);
      expect(secondRequestBody.messages[3].content).toBe('STUB SEARCH: nvda news');
      expect(secondRequestBody.tools?.[0]?.function?.name).toBe('web_search');
    } finally {
      restore();
      for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });
});

import http from 'http';
import type { AddressInfo } from 'net';
import { resolveChatBackend } from '../backend-config';
import { AgentRegistry } from '../registry';

const ENV_KEYS = ['AI_LOCAL_BASE_URL', 'AI_LOCAL_API_KEY', 'AI_LOCAL_MODEL', 'OPENROUTER_BASE_URL', 'OPENROUTER_API_KEY'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('resolveChatBackend', () => {
  it('defaults to OpenRouter', () => {
    const b = resolveChatBackend();
    expect(b.provider).toBe('openrouter');
    expect(b.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(b.resolveModel('openai/gpt-4o-mini')).toBe('openai/gpt-4o-mini');
  });

  it('routes to the local server when AI_LOCAL_BASE_URL is set', () => {
    process.env.AI_LOCAL_BASE_URL = 'http://127.0.0.1:1234/v1/';
    process.env.AI_LOCAL_MODEL = 'qwen2.5-coder-14b';
    const b = resolveChatBackend();
    expect(b.provider).toBe('local');
    expect(b.baseUrl).toBe('http://127.0.0.1:1234/v1');
    expect(b.resolveModel('openai/gpt-4o-mini')).toBe('qwen2.5-coder-14b');
    expect(b.apiKey).toBe('local-no-key');
  });
});

describe('AgentRegistry against a stub local server', () => {
  let server: http.Server;
  let baseUrl: string;
  let lastRequest: { path: string; auth: string | undefined; body: Record<string, unknown> } | null = null;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        lastRequest = {
          path: req.url ?? '',
          auth: req.headers.authorization,
          body: JSON.parse(raw) as Record<string, unknown>,
        };
        res.setHeader('Content-Type', 'text/event-stream');
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'stubbed local ' } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'completion' } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 3 } })}\n\n`);
        res.end('data: [DONE]\n\n');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it('CODEX.think() round-trips through the local backend with the model override', async () => {
    process.env.AI_LOCAL_BASE_URL = baseUrl;
    process.env.AI_LOCAL_MODEL = 'local-test-model';

    const result = await AgentRegistry.CODEX.think({
      system: 'You are a test.',
      prompt: 'ping',
      ledger: { mode: 'off' }, // skip the supabase-backed budget/usage ledger
    });

    expect(result.text).toBe('stubbed local completion');
    expect(result.provider).toBe('local');
    expect(result.model).toBe('local-test-model');
    expect(result.inputTokens).toBe(7);
    expect(result.outputTokens).toBe(3);

    // The wire shape the local server contract documents.
    expect(lastRequest?.path).toBe('/v1/chat/completions');
    expect(lastRequest?.auth).toBe('Bearer local-no-key');
    expect(lastRequest?.body.model).toBe('local-test-model');
    expect(lastRequest?.body.stream).toBe(true);
    expect(lastRequest?.body.stream_options).toEqual({ include_usage: true });
    expect(lastRequest?.body.messages).toEqual([
      { role: 'system', content: 'You are a test.' },
      { role: 'user', content: 'ping' },
    ]);
  });

  it('passes the lane slug through when no AI_LOCAL_MODEL override is set', async () => {
    process.env.AI_LOCAL_BASE_URL = baseUrl;

    const result = await AgentRegistry.CODEX.think({
      system: 's',
      prompt: 'p',
      ledger: { mode: 'off' },
    });

    expect(result.text).toBe('stubbed local completion');
    expect(lastRequest?.body.model).toBe('openai/gpt-4o-mini');
  });
});

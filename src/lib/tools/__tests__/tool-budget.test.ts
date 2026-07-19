import { __resetToolBudgetCacheForTest, consumeToolBudget, dailyToolCallCap } from '../tool-budget';
import { __setLiveToolForTest, executeLiveTool } from '../live-tools';
import { runResponsesToolRounds } from '@/lib/agents/tool-loop';

const SAVED = { cap: process.env.LIVE_TOOLS_DAILY_CALL_CAP, url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };

afterEach(() => {
  if (SAVED.cap === undefined) delete process.env.LIVE_TOOLS_DAILY_CALL_CAP;
  else process.env.LIVE_TOOLS_DAILY_CALL_CAP = SAVED.cap;
  if (SAVED.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = SAVED.url;
  if (SAVED.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = SAVED.key;
  __resetToolBudgetCacheForTest();
});

describe('tool budget gate', () => {
  it('cap parsing: default, explicit, and garbage input', () => {
    delete process.env.LIVE_TOOLS_DAILY_CALL_CAP;
    expect(dailyToolCallCap()).toBe(200);
    process.env.LIVE_TOOLS_DAILY_CALL_CAP = '50';
    expect(dailyToolCallCap()).toBe(50);
    process.env.LIVE_TOOLS_DAILY_CALL_CAP = 'nonsense';
    expect(dailyToolCallCap()).toBe(200);
  });

  it('cap=0 denies immediately with a model-readable message (kill switch)', async () => {
    process.env.LIVE_TOOLS_DAILY_CALL_CAP = '0';
    const denial = await consumeToolBudget();
    expect(denial).toContain('disabled');
  });

  it('executeLiveTool surfaces the denial instead of running the tool', async () => {
    process.env.LIVE_TOOLS_DAILY_CALL_CAP = '0';
    let ran = false;
    const restore = __setLiveToolForTest({
      name: 'web_search',
      description: 'x',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        ran = true;
        return 'should not run';
      },
    });
    try {
      const out = await executeLiveTool('web_search', { query: 'q' });
      expect(out).toContain('disabled');
      expect(ran).toBe(false);
    } finally {
      restore();
    }
  });

  it('fails OPEN when the ledger is unreachable (anti-runaway, not billing)', async () => {
    __resetToolBudgetCacheForTest();
    process.env.LIVE_TOOLS_DAILY_CALL_CAP = '10';
    // No supabase env in jest → getAdminClient throws → gate must allow.
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(await consumeToolBudget()).toBeNull();
  });
});

describe('runResponsesToolRounds — Responses API loop mechanics', () => {
  it('answers function_call items and echoes reasoning items back', async () => {
    const restore = __setLiveToolForTest({
      name: 'web_search',
      description: 'fake',
      inputSchema: { type: 'object', properties: {} },
      execute: async (args) => `RESP RESULTS: ${String(args.query)}`,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputsSeen: any[][] = [];
    let call = 0;
    try {
      const outcome = await runResponsesToolRounds({
        input: [{ role: 'user', content: 'latest AI news?' }],
        callModel: async (input) => {
          inputsSeen.push([...input]);
          call += 1;
          if (call === 1) {
            return {
              outputItems: [
                { type: 'reasoning', id: 'rs_1', summary: [] },
                { type: 'function_call', id: 'fc_1', call_id: 'call_9', name: 'web_search', arguments: '{"query":"ai news"}' },
              ],
              text: '',
              inputTokens: 12,
              outputTokens: 3,
              status: 'completed',
            };
          }
          return { outputItems: [{ type: 'message' }], text: 'AI news delivered.', inputTokens: 30, outputTokens: 9, status: 'completed' };
        },
      });
      expect(outcome.text).toBe('AI news delivered.');
      expect(outcome.toolRounds).toBe(1);
      expect(outcome.inputTokens).toBe(42);
      const second = inputsSeen[1];
      // Reasoning item echoed back (reasoning models require their own items),
      // then the function_call, then our function_call_output.
      expect(second.map((item) => item.type ?? item.role)).toEqual(['user', 'reasoning', 'function_call', 'function_call_output']);
      expect(second.at(-1)).toEqual({ type: 'function_call_output', call_id: 'call_9', output: 'RESP RESULTS: ai news' });
    } finally {
      restore();
    }
  });

  it('carries incomplete status through so callers report token-cap truncation', async () => {
    const outcome = await runResponsesToolRounds({
      input: [{ role: 'user', content: 'x' }],
      callModel: async () => ({ outputItems: [], text: '', inputTokens: 1, outputTokens: 1, status: 'incomplete', incompleteReason: 'max_output_tokens' }),
    });
    expect(outcome.text).toBe('');
    expect(outcome.status).toBe('incomplete');
    expect(outcome.incompleteReason).toBe('max_output_tokens');
  });
});

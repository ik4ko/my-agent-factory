import {
  LIFE_CONTEXT_BLOCK_END,
  LIFE_CONTEXT_BLOCK_START,
  parseLifeContextProposals,
} from '../model-proposals';

describe('mentor life-context proposal parsing', () => {
  it('removes a valid machine block from the user-visible mentor response', () => {
    const output = `We can build that routine together.\n${LIFE_CONTEXT_BLOCK_START}\n[{"operation":"create","category":"routine","subject":"Morning walk","value":"Walks every morning","semanticKey":"routine:morning_walk","sensitivity":"ordinary","sourceBasis":"explicit","sourceQuote":"I walk every morning"}]\n${LIFE_CONTEXT_BLOCK_END}`;
    const parsed = parseLifeContextProposals(output);
    expect(parsed.content).toBe('We can build that routine together.');
    expect(parsed.candidates).toHaveLength(1);
  });

  it('rejects invalid proposal JSON without exposing the machine block', () => {
    const parsed = parseLifeContextProposals(`Reply\n${LIFE_CONTEXT_BLOCK_START}{bad json${LIFE_CONTEXT_BLOCK_END}`);
    expect(parsed.content).toBe('Reply');
    expect(parsed.candidates).toEqual([]);
  });
});

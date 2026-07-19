import { detectQuickInfo } from '../quick-info';

describe('detectQuickInfo', () => {
  it.each([
    ["what's NVDA at?", { toolName: 'get_stock_quote', args: { symbol: 'NVDA' } }],
    ['quote for AAPL', { toolName: 'get_stock_quote', args: { symbol: 'AAPL' } }],
    ['weather in Chicago', { toolName: 'get_weather', args: { location: 'Chicago' } }],
    ["what's the temperature in New York, NY?", { toolName: 'get_weather', args: { location: 'New York, NY' } }],
    ['look up the current US inflation rate', { toolName: 'web_search', args: { query: 'the current US inflation rate' } }],
  ])('matches an unmistakable lookup: %s', (prompt, expected) => {
    expect(detectQuickInfo(prompt)).toEqual(expected);
  });

  it.each([
    'Compare NVDA and AMD prices',
    'What is NVDA at and should I buy it?',
    'Weather in Chicago and NVDA quote',
    'Why is NVDA down?',
    'Give me the weather outlook for Chicago next week',
    'What is the capital of Georgia?',
  ])('falls through ambiguous or compound work: %s', (prompt) => {
    expect(detectQuickInfo(prompt)).toBeNull();
  });
});

export interface QuickInfoMatch {
  toolName: 'get_stock_quote' | 'get_weather' | 'web_search';
  args: Record<string, string>;
}

const COMPOUND_OR_ANALYTICAL = /\b(?:and|also|then|compare|versus|vs\.?|why|explain|analy[sz]e|forecast|outlook|should|buy|sell|trade|position|portfolio|risk|news)\b/i;
const TICKER_STOPLIST = new Set(['A', 'AM', 'AT', 'FOR', 'I', 'IN', 'IS', 'IT', 'MY', 'THE', 'TO', 'US', 'USA', 'WHAT']);

/** Conservative local shortcut. False negatives are intentional: only an
 * unmistakable single quote or current-weather lookup bypasses the model. */
export function detectQuickInfo(prompt: string): QuickInfoMatch | null {
  const text = prompt.trim().replace(/\s+/g, ' ');
  if (!text || text.length > 140 || COMPOUND_OR_ANALYTICAL.test(text)) return null;

  const quotePatterns = [
    /^(?:what(?:'s| is)\s+)?(?:the\s+)?(?:stock\s+)?(?:price|quote)\s+(?:of|for|on)\s+\$?([A-Z]{1,5})(?:\s+(?:right now|now|today))?[?!.]?$/,
    /^(?:what(?:'s| is)|how much is)\s+\$?([A-Z]{1,5})\s+(?:at|trading at|worth)(?:\s+(?:right now|now|today))?[?!.]?$/,
    /^\$?([A-Z]{1,5})\s+(?:price|quote)(?:\s+(?:right now|now|today))?[?!.]?$/,
  ];
  for (const pattern of quotePatterns) {
    const symbol = text.match(pattern)?.[1];
    if (symbol && !TICKER_STOPLIST.has(symbol)) return { toolName: 'get_stock_quote', args: { symbol } };
  }

  const weatherMatch = text.match(
    /^(?:what(?:'s| is)\s+)?(?:the\s+)?(?:current\s+)?(?:weather|temperature)\s+(?:in|for|at)\s+(.+?)(?:\s+(?:right now|now|today))?[?!.]?$/i,
  );
  const location = weatherMatch?.[1]?.trim();
  if (location && /^[\p{L}\p{M} .,'-]{2,80}$/u.test(location)) {
    return { toolName: 'get_weather', args: { location } };
  }

  const searchQuery = text.match(/^(?:look up|search(?: the web)? for)\s+(.+?)[?!.]?$/i)?.[1]?.trim();
  if (searchQuery && searchQuery.length >= 3 && searchQuery.length <= 100) {
    return { toolName: 'web_search', args: { query: searchQuery } };
  }
  return null;
}

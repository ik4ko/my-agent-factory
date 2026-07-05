// Order-intent extraction — the deterministic scan of a trade-loop brain's
// decision text, mirroring extractTradeParams in trading.types.ts. No LLM
// call happens here: it's regex + zod, and returning null (no intent) is
// always preferable to guessing. A loop's brain is instructed to emit this
// exact machine-readable line ONLY when it wants to act right now:
//   ORDER_INTENT: {"symbol":"NVDA","side":"buy","qty":1,"type":"market","reason":"..."}
import { z } from 'zod';

const RawIntentSchema = z.object({
  symbol: z.string().trim().toUpperCase().regex(/^[A-Z]{1,6}$/),
  side: z.enum(['buy', 'sell']),
  qty: z.number().positive().finite().optional(),
  notional: z.number().positive().finite().optional(),
  type: z.enum(['market', 'limit']).optional().default('market'),
  limitPrice: z.number().positive().finite().optional(),
  reason: z.string().trim().min(1).max(500),
});
export type RawOrderIntent = z.infer<typeof RawIntentSchema>;

export function extractOrderIntent(decisionText: string): RawOrderIntent | null {
  const block = decisionText.match(/ORDER_INTENT\s*:\s*(\{[^\n]*\})/);
  if (!block) return null;
  try {
    const parsed = RawIntentSchema.safeParse(JSON.parse(block[1]));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

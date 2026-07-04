import { getAdminClient } from '@/lib/supabase/admin';
import { DEFAULT_PAPER_EQUITY_USD } from '@/lib/types/trading.types';

/**
 * Portfolio state adapter — Phase 8 (server-side only).
 *
 * Reads the singleton `portfolio_state` row (RLS: service-role only; the
 * dashboard cannot see it) and returns the live liquid-cash balance that the
 * Kelly sizing engine allocates against.
 *
 * Fallback chain (strict, in order):
 *   1. portfolio_state.total_liquid_cash when present and > 0
 *   2. PAPER_EQUITY_USD env override
 *   3. DEFAULT_PAPER_EQUITY_USD ($100k paper baseline)
 *
 * Never throws and never returns a non-positive number — a sizing engine
 * fed 0 or NaN would stage $0 orders or crash the pipeline mid-chain.
 */
export async function getActivePortfolioBalance(): Promise<number> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getAdminClient() as any;
    const { data, error } = await db
      .from('portfolio_state')
      .select('total_liquid_cash')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message ?? 'portfolio_state read failed');

    // numeric(12,2) may arrive as number or string depending on the
    // serialization path — coerce defensively.
    const balance = Number(data?.total_liquid_cash);
    if (Number.isFinite(balance) && balance > 0) return balance;
  } catch {
    /* fall through to the static chain */
  }

  const env = Number(process.env.PAPER_EQUITY_USD);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_PAPER_EQUITY_USD;
}

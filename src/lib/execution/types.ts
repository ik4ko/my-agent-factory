// Execution domain — the contract every loop-engine trade decision routes
// through. The only implementation is the paper/simulation adapter.
import { z } from 'zod';

export const OrderIntentSchema = z.object({
  clientOrderId: z.string().uuid(),
  loopId: z.string().uuid(),
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{1,6}$/, 'symbol must be a 1-6 letter uppercase ticker'),
  side: z.enum(['buy', 'sell']),
  qty: z.number().positive().finite().optional(),
  notional: z.number().positive().finite().optional(),
  type: z.enum(['market', 'limit']).optional().default('market'),
  limitPrice: z.number().positive().finite().optional(),
  reason: z.string().trim().min(1).max(500),
});
export type OrderIntent = z.infer<typeof OrderIntentSchema>;

export interface Quote {
  symbol: string;
  price: number;
  asOf: string;
  source: 'YAHOO' | 'SIMULATED';
}

export interface Position {
  symbol: string;
  qty: number;
  avgCost: number;
  marketValue: number;
}

export interface Portfolio {
  cash: number;
  equity: number;
  positions: Position[];
  asOf: string;
}

export interface OrderResult {
  status: 'dry_run' | 'intent' | 'submitted' | 'filled' | 'rejected' | 'canceled';
  fillPrice?: number;
  reason?: string;
}

export type ExecutionAdapterName = 'dryrun';

export interface ExecutionAdapter {
  name: ExecutionAdapterName;
  /** Cheap reachability + auth check — must never throw. */
  isReady(): Promise<boolean>;
  getPortfolio(): Promise<Portfolio>;
  getQuote(symbol: string): Promise<Quote>;
  getPositions(): Promise<Position[]>;
  placeOrder(intent: OrderIntent): Promise<OrderResult>;
}

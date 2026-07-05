// BridgeAdapter — "app → Claude → agentic Robinhood" fallback path, decoupled
// through the DB so it survives across sessions/restarts.
//
// placeOrder does NOT call a brokerage — it just returns status:'intent'.
// The engine (src/lib/loops/engine.ts) writes exactly one `orders` row per
// placeOrder call using this result, so the row it creates with
// status='intent' IS the signal. scripts/executor-agent.mts polls
// `orders where status='intent'`, claims one, drives the Robinhood MCP, and
// updates that same row in place (status/broker_id/fill_price/reason) — it
// never inserts a second row.
//
// Reads (quote/portfolio/positions) have no synchronous live-broker path in
// this model (the executor agent is an async poller, not a request/response
// service), so they proxy through DryRunAdapter's real-market-data reads
// rather than fabricate broker figures.
import { DryRunAdapter } from './dry-run-adapter';
import type { ExecutionAdapter, OrderIntent, OrderResult, Portfolio, Position, Quote } from './types';

const reads = new DryRunAdapter();

export class BridgeAdapter implements ExecutionAdapter {
  name = 'bridge' as const;

  async isReady(): Promise<boolean> {
    // "Ready" means the Anthropic key an executor-agent process would need
    // is configured. It says nothing about whether that process is actually
    // running — an intent can sit at status='intent' until it is.
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  getQuote(symbol: string): Promise<Quote> {
    return reads.getQuote(symbol);
  }

  getPortfolio(): Promise<Portfolio> {
    return reads.getPortfolio();
  }

  getPositions(): Promise<Position[]> {
    return reads.getPositions();
  }

  async placeOrder(intent: OrderIntent): Promise<OrderResult> {
    return { status: 'intent', reason: `queued for executor-agent — ${intent.reason}` };
  }

  async cancelOrder(): Promise<void> {
    // Cancellation of a queued (not-yet-executed) intent is a plain status
    // update on the orders row — handled by the caller, not this adapter.
  }
}

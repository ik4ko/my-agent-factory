// DryRunAdapter — the always-available, never-fails backend. Used whenever
// simulation execution. Never touches a brokerage; getQuote is market data (Yahoo, with the
// project's existing simulated fallback) so sizing/risk math still works
// against realistic numbers even while nothing is armed.
import { getMarketContext } from '@/lib/market/fetcher';
import type { ExecutionAdapter, OrderIntent, OrderResult, Portfolio, Position, Quote } from './types';
import { getActivePortfolioBalance } from '@/lib/market/portfolio';

export class DryRunAdapter implements ExecutionAdapter {
  name = 'dryrun' as const;

  async isReady(): Promise<boolean> {
    return true;
  }

  async getQuote(symbol: string): Promise<Quote> {
    const ctx = await getMarketContext(symbol);
    return { symbol: ctx.ticker, price: ctx.price, asOf: ctx.asOf, source: ctx.source };
  }

  async getPortfolio(): Promise<Portfolio> {
    const cash = await getActivePortfolioBalance();
    return { cash, equity: cash, positions: [], asOf: new Date().toISOString() };
  }

  async getPositions(): Promise<Position[]> {
    return [];
  }

  async placeOrder(intent: OrderIntent): Promise<OrderResult> {
    const quote = await this.getQuote(intent.symbol);
    return { status: 'dry_run', fillPrice: quote.price, reason: `dry-run — ${intent.reason}` };
  }

}

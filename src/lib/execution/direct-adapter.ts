// DirectAdapter — talks to the `robin_stocks` sidecar (services/robinhood/),
// a tiny FastAPI service bound to 127.0.0.1 that holds the real Robinhood
// session. This adapter never sees credentials; it only ever calls the
// sidecar's localhost HTTP API. See services/robinhood/README.md to run it.
import type { ExecutionAdapter, OrderIntent, OrderResult, Portfolio, Position, Quote } from './types';

const TIMEOUT_MS = 8_000;

function baseUrl(): string {
  return (process.env.ROBINHOOD_SIDECAR_URL ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`sidecar ${path} responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

export class DirectAdapter implements ExecutionAdapter {
  name = 'direct' as const;

  async isReady(): Promise<boolean> {
    try {
      const health = await call<{ ok: boolean; authenticated: boolean }>('/health');
      return Boolean(health.ok && health.authenticated);
    } catch {
      return false;
    }
  }

  async getQuote(symbol: string): Promise<Quote> {
    const q = await call<{ price: number; asOf: string }>(`/quote/${encodeURIComponent(symbol)}`);
    return { symbol, price: q.price, asOf: q.asOf, source: 'BROKER' };
  }

  async getPortfolio(): Promise<Portfolio> {
    return call<Portfolio>('/portfolio');
  }

  async getPositions(): Promise<Position[]> {
    const { positions } = await call<{ positions: Position[] }>('/positions');
    return positions;
  }

  async placeOrder(intent: OrderIntent): Promise<OrderResult> {
    const sized: OrderIntent = { ...intent };
    if (!sized.qty && sized.notional) {
      const quote = await this.getQuote(sized.symbol);
      const qty = Math.floor((sized.notional / quote.price) * 1_000_000) / 1_000_000;
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error(`cannot size ${sized.symbol} from notional $${sized.notional}`);
      }
      sized.qty = qty;
      sized.reason = `${sized.reason} (sized ${qty} shares from $${sized.notional.toFixed(2)} notional @ $${quote.price.toFixed(2)})`;
    }
    if (!sized.qty) {
      throw new Error('direct adapter refused order with no qty or notional size');
    }
    return call<OrderResult>('/order', { method: 'POST', body: JSON.stringify(sized) });
  }

  async cancelOrder(brokerId: string): Promise<void> {
    await call('/cancel', { method: 'POST', body: JSON.stringify({ brokerId }) });
  }
}

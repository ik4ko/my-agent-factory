jest.mock('@/lib/market/fetcher', () => ({ getMarketContext: jest.fn() }));
jest.mock('@/lib/market/portfolio', () => ({ getActivePortfolioBalance: jest.fn() }));

import { selectAdapter } from '@/lib/execution/select-adapter';

describe('simulation-only execution boundary', () => {
  it('cannot select a live adapter even when legacy live flags are injected', async () => {
    process.env.TRADING_ENABLED = 'true';
    process.env.ROBINHOOD_SIDECAR_URL = 'https://broker.invalid';
    process.env.EXECUTOR_ROBINHOOD_MCP_URL = 'https://broker.invalid/mcp';

    await expect(selectAdapter()).resolves.toMatchObject({ name: 'dryrun' });

    delete process.env.TRADING_ENABLED;
    delete process.env.ROBINHOOD_SIDECAR_URL;
    delete process.env.EXECUTOR_ROBINHOOD_MCP_URL;
  });
});

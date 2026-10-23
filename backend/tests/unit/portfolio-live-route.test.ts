import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readWallet: vi.fn(), readJson: vi.fn(), write: vi.fn(), lock: vi.fn(),
  paperStatus: vi.fn(), paperAdvance: vi.fn(), paperTestbed: vi.fn(), network: vi.fn(),
}));
vi.mock('../../src/portfolio/paper-service', () => ({
  portfolioPaperStatus: mocks.paperStatus, advancePortfolioPaper: mocks.paperAdvance, startPortfolioTestbed: mocks.paperTestbed,
}));
vi.mock('../../src/portfolio/paper-store', () => ({
  backendRoot: '/read-only-route-test/backend', readJson: mocks.readJson, writeJsonAtomic: mocks.write,
  PortfolioBusyError: class PortfolioBusyError extends Error {},
}));
vi.mock('../../src/portfolio/live-store', () => ({
  readLiveWallet: mocks.readWallet, writeLiveWallet: mocks.write, withLiveWalletLock: mocks.lock,
}));
// Importing the HTTP read path must never even load an execution entrypoint.
vi.mock('../../src/portfolio/live-broker', () => { throw new Error('Live read route imported a broker'); });
vi.mock('../../src/portfolio/live-worker', () => { throw new Error('Live read route imported an execution worker'); });
vi.mock('../../src/portfolio/market-data', () => { throw new Error('Live read route imported network market data'); });

import router from '../../src/routes/portfolio-paper';
import { LIVE_POLICY_ID } from '../../src/portfolio/live-service';

async function invoke(method: string, path: string, query: Record<string, unknown> = {}) {
  const layer = (router as any).stack.find((entry: any) => entry.route?.path === path && entry.route.methods[method]);
  if (!layer) throw new Error('Route is not registered');
  let code = 200, contentType: string | undefined, payload: any;
  const res = {
    status(value: number) { code = value; return this; }, type(value: string) { contentType = value; return this; },
    json(value: unknown) { payload = value; return this; }, send(value: unknown) { payload = value; return this; },
  };
  await layer.route.stack[0].handle({ query, body: { enabled: true, initialCash: '100000', forceOrder: true } }, res);
  return { code, contentType, payload };
}
function expectReadOnly() {
  expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.lock).not.toHaveBeenCalled();
  expect(mocks.paperAdvance).not.toHaveBeenCalled(); expect(mocks.paperTestbed).not.toHaveBeenCalled();
  expect(mocks.paperStatus).not.toHaveBeenCalled(); expect(mocks.network).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('PORTFOLIO_LIVE_ENABLED', 'false'); vi.stubEnv('PORTFOLIO_LIVE_INITIAL_CASH', '100');
  vi.stubEnv('PORTFOLIO_LIVE_DATA_DIR', '/read-only-route-test/live');
  mocks.readWallet.mockResolvedValue(null); mocks.readJson.mockResolvedValue(null);
  mocks.network.mockImplementation(() => { throw new Error('Read route made a network request'); });
  vi.stubGlobal('fetch', mocks.network);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('authenticated portfolio live read-only HTTP view', () => {
  it('reports configured live mode and missing observations without fabricating a wallet or PnL', async () => {
    const result = await invoke('get', '/live', { enabled: true, initialCash: '100000' });
    expect(result.code).toBe(200);
    expect(result.payload).toMatchObject({ success: true, data: {
      mode: 'live', enabled: false, policyId: LIVE_POLICY_ID, wallet: null, worker: null, readiness: null,
      config: { initialCapital: '100', dailyLossLimitUsd: '12', closeBufferUsd: '6.1', softLossThresholdUsd: '-5.9' },
      continuousRiskGuarantee: false,
    } });
    expect(mocks.readWallet).toHaveBeenCalledWith('/read-only-route-test/live');
    expect(mocks.readJson.mock.calls.map(call => call[0]).sort()).toEqual([
      '/read-only-route-test/live/readiness.json', '/read-only-route-test/live/worker-status.json',
    ]);
    expectReadOnly();
  });

  it('returns only persisted actual monetary strings, omits ownership internals and never edits the stored wallet', async () => {
    vi.stubEnv('PORTFOLIO_LIVE_ENABLED', 'true');
    const stored = {
      policyId: LIVE_POLICY_ID, accountIdentity: 'private-account-identity', handoffSha256: 'private-receipt-hash',
      config: { initialCash: '31.47744546', dailyLossLimitUsd: '15', closeBufferUsd: '6.1', softLossThresholdUsd: '-8.9' },
      processedTradeIds: ['private-dedup-trade'], processedIncomeIds: ['private-dedup-income'],
      equity: '99.12345678901234567890123456789', netPnl: '-.87654321098765432109876543211',
      totalFees: '.005', fundingPnl: '-.001', realizedPnl: '0', currentDay: { netPnl: '-.87654321098765432109876543211', riskLatched: false },
      positions: { BTCUSDT: { quantity: '.001', averageEntry: '60000' } },
      actualPositions: [{ symbol: 'BTCUSDT', positionAmt: '.001', entryPrice: '60000' }],
      trades: Array.from({ length: 105 }, (_, id) => ({ id: String(id), commission: '.005' })),
      incomes: Array.from({ length: 103 }, (_, tranId) => ({ tranId: String(tranId), incomeType: 'FUNDING_FEE', income: '-.001' })),
      intents: Array.from({ length: 104 }, (_, id) => ({ clientOrderId: 'actual_' + id })),
      days: Array.from({ length: 130 }, (_, id) => ({ day: String(id) })),
    };
    const before = JSON.stringify(stored);
    mocks.readWallet.mockResolvedValue(stored);
    mocks.readJson.mockImplementation(async (path: string) => path.endsWith('worker-status.json')
      ? { status: 'running', lastSuccessfulTick: '2026-10-16T13:00:00Z' } : { ready: true });
    const result = await invoke('get', '/live');
    expect(result.payload.data.enabled).toBe(true);
    // Report the persisted running policy during a rolling policy migration.
    expect(result.payload.data.config.dailyLossLimitUsd).toBe('15');
    expect(result.payload.data.config.softLossThresholdUsd).toBe('-8.9');
    const wallet = result.payload.data.wallet;
    for (const field of ['equity', 'netPnl', 'totalFees', 'fundingPnl', 'realizedPnl']) expect(wallet[field]).toBe(stored[field as keyof typeof stored]);
    for (const field of ['accountIdentity', 'handoffSha256', 'processedTradeIds', 'processedIncomeIds']) expect(wallet).not.toHaveProperty(field);
    expect(wallet.trades).toHaveLength(100); expect(wallet.trades[0].id).toBe('5');
    expect(wallet.incomes).toHaveLength(100); expect(wallet.intents).toHaveLength(100); expect(wallet.days).toHaveLength(128);
    expect(JSON.stringify(stored)).toBe(before);
    expect(result.payload.data.worker.status).toBe('running'); expect(result.payload.data.readiness.ready).toBe(true);
    expectReadOnly();
  });

  it('serves the live page without reading a wallet, starting execution, or exposing mutation routes', async () => {
    const result = await invoke('get', '/live/view');
    expect(result.code).toBe(200); expect(result.contentType).toBe('html');
    expect(result.payload).toContain('Danh mục Futures giao dịch thật');
    expect(result.payload).toContain("endpoint='/api/portfolio-paper/live'");
    expect(result.payload).toContain("method:'GET'");
    expect(result.payload).not.toContain("method:'POST'"); expect(result.payload).not.toContain('<button');
    expect(result.payload).not.toContain('innerHTML');
    const liveRoutes = (router as any).stack.filter((entry: any) => String(entry.route?.path).startsWith('/live'));
    expect(liveRoutes).toHaveLength(2);
    for (const layer of liveRoutes) expect(Object.keys(layer.route.methods)).toEqual(['get']);
    expect(mocks.readWallet).not.toHaveBeenCalled(); expect(mocks.readJson).not.toHaveBeenCalled(); expectReadOnly();
  });

  it('returns a generic503 when persisted reads fail and never sends internal error data to the browser', async () => {
    mocks.readWallet.mockRejectedValue(new Error('private API secret or signed URL in an internal failure'));
    const result = await invoke('get', '/live');
    expect(result.code).toBe(503);
    expect(result.payload).toEqual({ success: false, error: 'Live portfolio status is unavailable' });
    expectReadOnly();
  });
});

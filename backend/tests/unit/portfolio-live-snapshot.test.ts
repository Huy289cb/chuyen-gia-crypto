import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Decimal } from '@prisma/client/runtime/library';
import type { LiveBroker } from '../../src/portfolio/live-broker';
import { LiveBackgroundSupport } from '../../src/portfolio/live-background';
import { advanceLivePortfolio, LIVE_POLICY_ID, LIVE_SYMBOLS, type AdvanceLivePortfolioOptions } from '../../src/portfolio/live-service';
import type { ConstantDirectionSourcePortfolioTargets } from '../../src/portfolio/source-constant-direction';
import { readLiveWallet, writeLiveWallet } from '../../src/portfolio/live-store';

const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
const d = (value: string | number) => new Money(value);
const directories: string[] = [];
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

/** In-memory authenticated venue; every call and fill stays offline. */
class SnapshotBroker {
  identity = 'snapshot-race-authenticated-account';
  now = Date.parse('2026-10-16T12:00:00Z');
  wallet = d('100');
  bad: 'none' | 'regular' | 'algo' | 'leverage' | 'ledger' = 'none';
  positions: Record<string, { quantity: Decimal; entry: Decimal }> = {};
  orders = new Map<string, any>();
  trades: any[] = [];
  income: any[] = [];
  submits: any[] = [];
  async getAccount() {
    const gross = Object.values(this.positions).reduce((sum, position) => sum.plus(position.quantity.abs().mul(100)), d(0));
    return { canTrade: true, totalWalletBalance: this.wallet.toString(), totalUnrealizedProfit: '0',
      totalMarginBalance: this.wallet.toString(), availableBalance: this.wallet.minus(gross.div(10)).toString(),
      assets: [{ asset: 'USDT', walletBalance: this.wallet.toString(), unrealizedProfit: '0' }] };
  }
  async getPositions() { return LIVE_SYMBOLS.map(symbol => ({ symbol, positionAmt: this.positions[symbol]?.quantity.toString() ?? '0',
    entryPrice: this.positions[symbol]?.entry.toString() ?? '0', markPrice: '100', unRealizedProfit: '0',
    positionSide: 'BOTH', leverage: '10', marginType: 'cross', isolatedWallet: '0' })); }
  async getPositionMode() { return { dualSidePosition: false }; }
  async getOpenOrders() { return this.bad === 'regular' ? [{ symbol: 'BTCUSDT', clientOrderId: 'external-order', orderId: 'external' }] : []; }
  async getOpenAlgoOrders() { return this.bad === 'algo' ? [{ symbol: 'BTCUSDT', clientAlgoId: 'external-algo', algoId: 'external' }] : []; }
  async getMarkPrices() { return LIVE_SYMBOLS.map(symbol => ({ symbol, markPrice: '100', time: this.now })); }
  async getTickerPrices() { return LIVE_SYMBOLS.map(symbol => ({ symbol, price: '100', time: this.now })); }
  async getCommissionRate(symbol: string) { return { symbol, makerCommissionRate: '.0002', takerCommissionRate: '.0005' }; }
  async getSymbolConfiguration() { return LIVE_SYMBOLS.map(symbol => ({ symbol, marginType: 'CROSSED', leverage: this.bad === 'leverage' ? '20' : '10' })); }
  async getExchangeInfo() { return { symbols: LIVE_SYMBOLS.map(symbol => ({ symbol, status: 'TRADING', contractType: 'PERPETUAL',
    quoteAsset: 'USDT', marginAsset: 'USDT', filters: [
      { filterType: 'LOT_SIZE', stepSize: '.01', minQty: '.01', maxQty: '1000' },
      { filterType: 'MARKET_LOT_SIZE', stepSize: '.01', minQty: '.01', maxQty: '1000' },
      { filterType: 'MIN_NOTIONAL', notional: '1' },
    ] })) }; }
  async getIncome(query: any) { return this.income.filter(row => row.time >= query.startTime && row.time <= query.endTime); }
  async getUserTrades(query: any) {
    return [...this.trades.filter(row => row.symbol === query.symbol && row.time >= query.startTime && row.time <= query.endTime),
      ...(this.bad === 'ledger' && query.symbol === 'BTCUSDT' ? [{ symbol: 'BTCUSDT', id: 'external-trade',
        orderId: 'external-order', qty: '.01', price: '100', side: 'BUY', commissionAsset: 'USDT',
        commission: '.0005', realizedPnl: '0', time: this.now }] : [])];
  }
  async queryOrder(_symbol: string, clientOrderId: string) {
    const order = this.orders.get(clientOrderId);
    if (!order) throw Object.assign(new Error('Order missing'), { binanceCode: -2013 });
    return order;
  }
  async submitMarketOrder(request: any) {
    this.submits.push(request);
    const quantity = d(request.quantity), fee = quantity.mul(100).mul('.0005');
    const previous = this.positions[request.symbol]?.quantity ?? d(0);
    this.positions[request.symbol] = { quantity: previous.plus(quantity), entry: d(100) };
    this.wallet = this.wallet.minus(fee);
    const id = String(this.submits.length);
    const order = { symbol: request.symbol, clientOrderId: request.clientOrderId, orderId: id,
      status: 'FILLED', executedQty: quantity.toString() };
    this.orders.set(request.clientOrderId, order);
    this.trades.push({ symbol: request.symbol, id, orderId: id, qty: quantity.toString(), price: '100',
      side: request.side, commissionAsset: 'USDT', commission: fee.toString(), realizedPnl: '0', time: this.now });
    this.income.push({ incomeType: 'COMMISSION', symbol: request.symbol, tranId: `fee-${id}`, asset: 'USDT',
      income: fee.negated().toString(), time: this.now });
    return order;
  }
}

async function fixture() {
  const broker = new SnapshotBroker();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'live-snapshot-test-'));
  directories.push(directory);
  const receiptPath = path.join(directory, 'handoff.json');
  await fs.writeFile(receiptPath, JSON.stringify({ owner: LIVE_POLICY_ID, accountIdentity: broker.identity,
    legacyWorkerStopped: true, legacyMutationsBlocked: true, verifiedAtMs: broker.now,
    verifiedSetup: { positionMode: 'ONE_WAY', marginType: 'CROSSED', leverage: '10', symbols: [...LIVE_SYMBOLS] } }));
  const options: AdvanceLivePortfolioOptions = { broker: broker as unknown as LiveBroker, directory,
    accountIdentity: broker.identity, handoff: { owner: LIVE_POLICY_ID, receiptPath }, now: () => broker.now };
  await advanceLivePortfolio(options);
  return { broker, options };
}

function targets(time: number): ConstantDirectionSourcePortfolioTargets {
  return { strategy: 'constant-direction-b5-v1', policyId: LIVE_POLICY_ID, sourceId: `constant:${time}`,
    knownAtMs: time, executeAtMs: time, labelTimeMs: time - 86_400_000,
    decimalWeights: Object.fromEntries(LIVE_SYMBOLS.map(symbol => [symbol, '.2'])),
    weights: Object.fromEntries(LIVE_SYMBOLS.map(symbol => [symbol, .2])),
    metadata: Object.fromEntries(LIVE_SYMBOLS.map(symbol => [symbol, { signalCountChanged: false }])) } as ConstantDirectionSourcePortfolioTargets;
}

describe('authorization uses the auxiliary snapshot reconciled with its account observation', () => {
  it.each([
    ['regular', /unowned exchange regular order/i],
    ['algo', /unowned exchange algo order/i],
    ['leverage', /leverage\/margin configuration/i],
    ['ledger', /background ledger reconciliation failed/i],
  ] as const)('does not borrow freshness from an unchecked %s update published during the account read', async (bad, rejection) => {
    const f = await fixture();
    let support: LiveBackgroundSupport | undefined;
    const originalSnapshot = LiveBackgroundSupport.prototype.snapshot;
    vi.spyOn(LiveBackgroundSupport.prototype, 'snapshot').mockImplementation(function (this: LiveBackgroundSupport) {
      support = this;
      return originalSnapshot.call(this);
    });
    const tick = () => advanceLivePortfolio({ ...f.options, nonBlockingMonitoring: true });
    // Populate the real fetch-only lanes with a clean but previous-source snapshot A.
    await tick();
    await new Promise<void>(resolve => setImmediate(resolve));
    await tick();
    expect(support?.snapshot().history).not.toBeNull();
    const oldCursor = Date.parse('2026-10-16T00:00:00Z');
    const scheduled = Date.parse('2026-10-17T00:00:00Z');
    f.broker.now = scheduled;
    f.broker.bad = bad;
    const accountStarted = deferred<void>(), releaseAccount = deferred<void>();
    const account = f.broker.getAccount.bind(f.broker);
    f.broker.getAccount = async () => {
      accountStarted.resolve();
      await releaseAccount.promise;
      return account();
    };
    const attempt = advanceLivePortfolio({ ...f.options, nonBlockingMonitoring: true, targets: targets(scheduled), sourcePending: true });
    await accountStarted.promise;
    // The authenticated read is still in flight. Background B has completed, but
    // refresh has already captured A and therefore has not validated any row in B.
    await new Promise<void>(resolve => setImmediate(resolve));
    const published = support!.snapshot();
    expect(published.metadata?.at).toBe(scheduled);
    expect(published.orders?.at).toBe(scheduled);
    expect(published.history?.through).toBe(scheduled);
    expect(Object.values(published.pending).every(value => value === false)).toBe(true);
    releaseAccount.resolve();
    const staleObservation = await attempt;
    expect(f.broker.submits).toHaveLength(0);
    expect(staleObservation.sourceCursorMs).toBe(oldCursor);
    expect(staleObservation.pendingSourcePlan).toBeUndefined();
    expect(staleObservation.lastObservation.background).toMatchObject({ historyThroughMs: Date.parse('2026-10-16T12:00:00Z') });

    // B only becomes authoritative after its ownership/configuration/ledger is
    // checked with the following account observation, which must reject it.
    f.broker.getAccount = account;
    f.broker.now += 2000;
    const checkedBadSnapshot = await advanceLivePortfolio({ ...f.options, nonBlockingMonitoring: true,
      targets: targets(scheduled), sourcePending: true });
    expect(checkedBadSnapshot.blockedReason).toMatch(rejection);
    expect(f.broker.submits).toHaveLength(0);

    // Recreate only the in-memory cache after the external anomaly is removed.
    // The same durable wallet/current source may proceed once fresh rows have
    // actually been checked; the fix must not permanently consume or disable it.
    f.broker.bad = 'none';
    const restarted = new Proxy(f.broker, { get(target, key) {
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } }) as unknown as LiveBroker;
    f.options.broker = restarted;
    for (let retry = 0; retry < 5 && f.broker.submits.length === 0; retry++) {
      f.broker.now += 2000;
      await advanceLivePortfolio({ ...f.options, nonBlockingMonitoring: true, targets: targets(scheduled), sourcePending: true });
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    expect(f.broker.submits).toHaveLength(1);
    expect(f.broker.submits[0].reduceOnly).toBe(false);
    expect(new Set(f.broker.submits.map(order => order.clientOrderId)).size).toBe(1);
  });

  it('keeps an already durable source plan waiting when only an unchecked newer inventory meets its source boundary', async () => {
    const f = await fixture();
    let support: LiveBackgroundSupport | undefined;
    const originalSnapshot = LiveBackgroundSupport.prototype.snapshot;
    vi.spyOn(LiveBackgroundSupport.prototype, 'snapshot').mockImplementation(function (this: LiveBackgroundSupport) {
      support = this;
      return originalSnapshot.call(this);
    });
    await advanceLivePortfolio({ ...f.options, nonBlockingMonitoring: true });
    await new Promise<void>(resolve => setImmediate(resolve));
    await advanceLivePortfolio({ ...f.options, nonBlockingMonitoring: true });
    const scheduled = Date.parse('2026-10-17T00:00:00Z');
    const stored = await readLiveWallet<any>(f.options.directory);
    stored.sourceCursorMs = scheduled;
    stored.lastSourceId = `constant:${scheduled}`;
    stored.pendingSourcePlan = { sourceId: stored.lastSourceId, scheduledAtMs: scheduled, expiresAtMs: scheduled + 60_000,
      orders: [{ symbol: 'BTCUSDT', quantity: '.2', reduceOnly: false }], nextIndex: 0 };
    await writeLiveWallet(f.options.directory, stored);
    f.broker.now = scheduled;
    f.broker.bad = 'regular';
    const accountStarted = deferred<void>(), releaseAccount = deferred<void>();
    const account = f.broker.getAccount.bind(f.broker);
    f.broker.getAccount = async () => {
      accountStarted.resolve();
      await releaseAccount.promise;
      return account();
    };
    const attempt = advanceLivePortfolio({ ...f.options, nonBlockingMonitoring: true });
    await accountStarted.promise;
    await new Promise<void>(resolve => setImmediate(resolve));
    const newer = support!.snapshot();
    expect(newer.orders?.at).toBe(scheduled);
    expect(newer.orders?.regular).toHaveLength(1);
    expect(newer.history?.through).toBe(scheduled);
    releaseAccount.resolve();
    const waiting = await attempt;
    expect(f.broker.submits).toHaveLength(0);
    expect(waiting.pendingSourcePlan?.nextIndex).toBe(0);
    expect(waiting.sourceCursorMs).toBe(scheduled);
    f.broker.getAccount = account;
    f.broker.now += 2000;
    const rejected = await advanceLivePortfolio({ ...f.options, nonBlockingMonitoring: true });
    expect(rejected.blockedReason).toMatch(/unowned exchange regular order/i);
    expect(f.broker.submits).toHaveLength(0);
    expect(rejected.pendingSourcePlan?.nextIndex).toBe(0);
  });
});

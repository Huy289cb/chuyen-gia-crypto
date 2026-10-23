import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Decimal } from '@prisma/client/runtime/library';
import type { LiveBroker } from '../../src/portfolio/live-broker';
import type { ConstantDirectionSourcePortfolioTargets } from '../../src/portfolio/source-constant-direction';
import { advanceLivePortfolio, LIVE_POLICY_ID, LIVE_SYMBOLS, type AdvanceLivePortfolioOptions } from '../../src/portfolio/live-service';
import { readLiveWallet, writeLiveWallet } from '../../src/portfolio/live-store';

const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
const d = (x: string | number) => new Money(x);
const directories: string[] = [];
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});

class MonitoringBroker {
  identity = 'test-authenticated-monitoring-account'; now = Date.parse('2026-10-16T12:00:00Z');
  wallet = d('100'); price = '100'; positions: Record<string, { q: Decimal; entry: Decimal }> = {};
  orders = new Map<string, any>(); trades: any[] = []; income: any[] = []; submits: any[] = []; counter = 0;
  unrealized() { return Object.values(this.positions).reduce((sum, p) => sum.plus(p.q.mul(d(this.price).minus(p.entry))), d(0)); }
  async getAccount() {
    const unrealized = this.unrealized(), equity = this.wallet.plus(unrealized);
    const gross = Object.values(this.positions).reduce((sum, p) => sum.plus(p.q.abs().mul(this.price)), d(0));
    return { canTrade: true, totalWalletBalance: this.wallet.toString(), totalUnrealizedProfit: unrealized.toString(),
      totalMarginBalance: equity.toString(), availableBalance: equity.minus(gross.div(10)).toString(),
      assets: [{ asset: 'USDT', walletBalance: this.wallet.toString(), unrealizedProfit: unrealized.toString() }] };
  }
  async getPositions() { return LIVE_SYMBOLS.map(symbol => ({ symbol, positionAmt: this.positions[symbol]?.q.toString() ?? '0',
    entryPrice: this.positions[symbol]?.entry.toString() ?? '0', markPrice: this.price, unRealizedProfit: '0',
    positionSide: 'BOTH', leverage: '10', marginType: 'cross', isolatedWallet: '0' })); }
  async getPositionMode() { return { dualSidePosition: false }; }
  async getOpenOrders(): Promise<any[]> { return []; }
  async getOpenAlgoOrders(): Promise<any[]> { return []; }
  async getMarkPrices() { return LIVE_SYMBOLS.map(symbol => ({ symbol, markPrice: this.price, time: this.now })); }
  async getTickerPrices() { return LIVE_SYMBOLS.map(symbol => ({ symbol, price: this.price, time: this.now })); }
  async getCommissionRate(symbol: string) { return { symbol, makerCommissionRate: '.0002', takerCommissionRate: '.0005' }; }
  async getSymbolConfiguration() { return LIVE_SYMBOLS.map(symbol => ({ symbol, marginType: 'CROSSED', leverage: '10' })); }
  async getExchangeInfo() { return { symbols: LIVE_SYMBOLS.map(symbol => ({ symbol, status: 'TRADING', contractType: 'PERPETUAL',
    quoteAsset: 'USDT', marginAsset: 'USDT', filters: [
      { filterType: 'LOT_SIZE', stepSize: '.01', minQty: '.01', maxQty: '1000' },
      { filterType: 'MARKET_LOT_SIZE', stepSize: '.01', minQty: '.01', maxQty: '1000' },
      { filterType: 'MIN_NOTIONAL', notional: '1' },
    ] })) }; }
  async getIncome(query: any) { return this.income.filter(x => x.time >= query.startTime && x.time <= query.endTime); }
  async getUserTrades(query: any) { return this.trades.filter(x => x.symbol === query.symbol && x.time >= query.startTime && x.time <= query.endTime); }
  async queryOrder(_symbol: string, clientId: string) {
    const order = this.orders.get(clientId);
    if (!order) throw Object.assign(new Error('Order missing'), { binanceCode: -2013 });
    return order;
  }
  async submitMarketOrder(request: any) {
    this.submits.push(request);
    const quantity = d(request.quantity), side = request.side === 'BUY' ? 1 : -1;
    const old = this.positions[request.symbol] ?? { q: d(0), entry: d(0) }, next = old.q.plus(quantity.mul(side));
    const price = d(this.price), fee = quantity.mul(price).mul('.0005');
    const realized = side < 0 ? quantity.mul(price.minus(old.entry)) : d(0);
    const average = side > 0 ? old.q.mul(old.entry).plus(quantity.mul(price)).div(next) : old.entry;
    if (next.isZero()) delete this.positions[request.symbol]; else this.positions[request.symbol] = { q: next, entry: average };
    this.wallet = this.wallet.plus(realized).minus(fee);
    const id = ++this.counter, order = { symbol: request.symbol, clientOrderId: request.clientOrderId, orderId: String(id),
      status: 'FILLED', executedQty: quantity.toString() };
    this.orders.set(request.clientOrderId, order);
    this.trades.push({ symbol: request.symbol, id: String(id), orderId: String(id), qty: quantity.toString(), price: this.price,
      side: request.side, commissionAsset: 'USDT', commission: fee.toString(), realizedPnl: realized.toString(), time: this.now });
    this.income.push({ incomeType: 'COMMISSION', symbol: request.symbol, tranId: `c${id}`, asset: 'USDT', income: fee.negated().toString(), time: this.now });
    if (!realized.isZero()) this.income.push({ incomeType: 'REALIZED_PNL', symbol: request.symbol, tranId: `r${id}`, asset: 'USDT', income: realized.toString(), time: this.now });
    return order;
  }
}

async function fixture() {
  const broker = new MonitoringBroker(), directory = await fs.mkdtemp(path.join(os.tmpdir(), 'live-monitoring-test-'));
  directories.push(directory);
  const receiptPath = path.join(directory, 'handoff.json');
  await fs.writeFile(receiptPath, JSON.stringify({ owner: LIVE_POLICY_ID, accountIdentity: broker.identity,
    legacyWorkerStopped: true, legacyMutationsBlocked: true, verifiedAtMs: broker.now,
    verifiedSetup: { positionMode: 'ONE_WAY', marginType: 'CROSSED', leverage: '10', symbols: [...LIVE_SYMBOLS] } }));
  const options: AdvanceLivePortfolioOptions = { broker: broker as unknown as LiveBroker, directory, accountIdentity: broker.identity,
    handoff: { owner: LIVE_POLICY_ID, receiptPath }, now: () => broker.now };
  return { broker, directory, options };
}
function targets(time: number): ConstantDirectionSourcePortfolioTargets {
  return { strategy: 'constant-direction-b5-v1', policyId: LIVE_POLICY_ID, sourceId: `constant:${time}`,
    knownAtMs: time, executeAtMs: time, labelTimeMs: time - 86_400_000,
    decimalWeights: Object.fromEntries(LIVE_SYMBOLS.map(symbol => [symbol, '.2'])),
    weights: Object.fromEntries(LIVE_SYMBOLS.map(symbol => [symbol, .2])),
    metadata: Object.fromEntries(LIVE_SYMBOLS.map(symbol => [symbol, { signalCountChanged: false }])) } as ConstantDirectionSourcePortfolioTargets;
}
const never = <T>(): Promise<T> => new Promise(() => {});
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Auxiliary REST work blocked authenticated risk monitoring')), 5000);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
async function entered() {
  const f = await fixture();
  await advanceLivePortfolio(f.options);
  f.broker.now = Date.parse('2026-10-17T00:00:00Z');
  const wallet = await advanceLivePortfolio({ ...f.options, targets: targets(f.broker.now) });
  expect(wallet.trades).toHaveLength(5);
  return f;
}
async function monitoringTick(f: Awaited<ReturnType<typeof fixture>>, extra: Partial<AdvanceLivePortfolioOptions> = {}) {
  return bounded(advanceLivePortfolio({ ...f.options, nonBlockingMonitoring: true, ...extra }));
}

describe('nonblocking authenticated portfolio risk monitoring', () => {
  it('keeps observing owned exposure while income and userTrades stay pending longer than15seconds', async () => {
    const f = await entered();
    await monitoringTick(f); // Prime support without changing the actual portfolio.
    f.broker.getIncome = vi.fn(async () => never<any[]>());
    f.broker.getUserTrades = vi.fn(async () => never<any[]>());
    const initialCount = f.broker.submits.length;
    let wallet = await monitoringTick(f);
    for (let tick = 0; tick < 28; tick++) {
      f.broker.now += 2000;
      wallet = await monitoringTick(f);
      expect(wallet.lastObservedAtMs).toBe(f.broker.now);
      expect(wallet.currentDay.riskLatched).toBe(false);
    }
    expect(f.broker.getIncome).toHaveBeenCalled();
    expect(f.broker.getUserTrades).toHaveBeenCalled();
    expect(f.broker.submits).toHaveLength(initialCount);
    expect(Object.keys(f.broker.positions)).toHaveLength(5);
  });

  it('keeps risk ticks flowing through hung metadata/order refresh and blocks new alpha on stale support', async () => {
    const f = await entered();
    await monitoringTick(f);
    f.broker.getExchangeInfo = vi.fn(async () => never<Awaited<ReturnType<MonitoringBroker['getExchangeInfo']>>>());
    f.broker.getOpenOrders = vi.fn(async () => never<any[]>());
    f.broker.getOpenAlgoOrders = vi.fn(async () => never<any[]>());
    const initialCount = f.broker.submits.length;
    let wallet = await monitoringTick(f);
    for (let tick = 0; tick < 55; tick++) {
      f.broker.now += 2000;
      wallet = await monitoringTick(f, { targets: targets(Date.parse('2026-10-17T00:00:00Z')) });
      expect(wallet.lastObservedAtMs).toBe(f.broker.now);
      expect(wallet.currentDay.riskLatched).toBe(false);
    }
    expect(f.broker.getExchangeInfo).toHaveBeenCalled();
    expect(f.broker.getOpenOrders).toHaveBeenCalled();
    expect(f.broker.submits).toHaveLength(initialCount);
    expect(wallet.blockedReason).toMatch(/support|stale|metadata|order/i);
  });

  it('still latches and reduces after a genuine authenticated account/quote outage exceeds15seconds', async () => {
    const f = await entered();
    await monitoringTick(f);
    const account = f.broker.getAccount.bind(f.broker);
    f.broker.getAccount = async () => { throw new Error('Authenticated account unavailable'); };
    for (let tick = 0; tick < 10; tick++) {
      f.broker.now += 2000;
      const failed = await monitoringTick(f);
      expect(failed.lastObservedAtMs).toBeLessThan(f.broker.now);
    }
    f.broker.getAccount = account;
    let recovered = await monitoringTick(f);
    for (let tick = 0; tick < 8 && Object.keys(f.broker.positions).length; tick++) {
      f.broker.now += 2000;
      recovered = await monitoringTick(f);
    }
    expect(recovered.currentDay.riskLatched).toBe(true);
    expect(recovered.currentDay.latchReason).toBe('live_monitoring_gap');
    expect(Object.keys(f.broker.positions)).toHaveLength(0);
    expect(f.broker.submits.filter(order => order.reduceOnly)).toHaveLength(5);
  });

  it('uses an authenticated funding debit to exit ACK-owned inventory even while history is hung', async () => {
    const f = await entered();
    const stored = await readLiveWallet<any>(f.directory);
    stored.positions = {}; stored.trades = []; stored.processedTradeIds = [];
    stored.intents.forEach((intent: any) => { intent.observedFillQty = '0'; });
    await writeLiveWallet(f.directory, stored);
    f.broker.wallet = f.broker.wallet.minus('10');
    f.broker.getIncome = async () => never<any[]>();
    f.broker.getUserTrades = async () => never<any[]>();
    f.broker.now += 2000;
    let wallet = await monitoringTick(f);
    for (let tick = 0; tick < 8 && Object.keys(f.broker.positions).length; tick++) {
      f.broker.now += 2000;
      wallet = await monitoringTick(f);
    }
    expect(wallet.currentDay.riskLatched).toBe(true);
    expect(wallet.currentDay.latchReason).not.toBe('live_monitoring_gap');
    expect(wallet.equityQuality).toBe('conservative_pending_income');
    expect(d(wallet.netPnl).lte('-10')).toBe(true);
    expect(Object.keys(f.broker.positions)).toHaveLength(0);
    expect(wallet.trades).toHaveLength(0); // ACK evidence authorizes exits but does not invent fill rows.
    expect(f.broker.submits.filter(order => order.reduceOnly)).toHaveLength(5);
  });

  it('persists a source plan across ticks and a broker restart without duplicate legs or late replay', async () => {
    const f = await fixture();
    await advanceLivePortfolio(f.options);
    await monitoringTick(f);
    const utc = Date.parse('2026-10-17T00:00:00Z');
    f.broker.now = utc;
    let wallet = await monitoringTick(f, { targets: targets(utc), sourcePending: true });
    expect(f.broker.submits.length).toBeLessThanOrEqual(1);
    for (let tick = 0; tick < 28 && f.broker.submits.length < 5; tick++) {
      if (tick === 3) {
        // New broker identity object recreates the in-memory support cache, while
        // retaining the same authenticated venue account and durable journal.
        f.options.broker = new Proxy(f.broker, { get(target, key) {
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        } }) as unknown as LiveBroker;
      }
      const before = f.broker.submits.length;
      f.broker.now += 2000;
      wallet = await monitoringTick(f, { targets: targets(utc), sourcePending: true });
      expect(f.broker.submits.length - before).toBeLessThanOrEqual(1);
    }
    expect(f.broker.submits).toHaveLength(5);
    expect(new Set(f.broker.submits.map(order => order.symbol)).size).toBe(5);
    expect(new Set(f.broker.submits.map(order => order.clientOrderId)).size).toBe(5);
    expect(wallet.sourceCursorMs).toBe(utc);
    expect((await readLiveWallet<any>(f.directory)).sourceCursorMs).toBe(utc);
    while (f.broker.now < utc + 62_000) {
      f.broker.now += 2000;
      await monitoringTick(f, { targets: targets(utc) });
    }
    expect(f.broker.submits).toHaveLength(5);
  });

  it('preserves a persisted daily risk latch and source cursor when enabling the fast monitor', async () => {
    const f = await fixture();
    const stored = await advanceLivePortfolio(f.options);
    stored.currentDay.riskLatched = true; stored.currentDay.latchReason = 'live_monitoring_gap';
    stored.status = 'reconciliation_required'; stored.blockedReason = 'Authenticated monitoring metadata warming';
    stored.sourceDisposition = 'risk_latched';
    await writeLiveWallet(f.directory, stored);
    f.broker.now += 2000;
    await monitoringTick(f, { targets: targets(stored.sourceCursorMs) });
    f.broker.now += 2000;
    const wallet = await monitoringTick(f, { targets: targets(stored.sourceCursorMs) });
    expect(wallet.currentDay.riskLatched).toBe(true);
    expect(wallet.currentDay.latchReason).toBe('live_monitoring_gap');
    expect(wallet.status).toBe('risk_latched');
    expect(wallet.blockedReason).toBe('live_monitoring_gap');
    expect(wallet.sourceCursorMs).toBe(stored.sourceCursorMs);
    expect(f.broker.submits).toHaveLength(0);
  });

  it('keeps owned risk observations fresh when an auxiliary history batch contains an unowned trade', async () => {
    const f = await entered();
    await monitoringTick(f);
    f.broker.now += 2000;
    await monitoringTick(f);
    const originalHistory = f.broker.getUserTrades.bind(f.broker);
    f.broker.getUserTrades = vi.fn(async query => [
      ...await originalHistory(query),
      ...(query.symbol === 'BTCUSDT' ? [{ symbol: 'BTCUSDT', id: 'unowned-background-trade',
        orderId: 'unowned-background-order', qty: '.01', price: '100', side: 'BUY',
        commissionAsset: 'USDT', commission: '.0005', realizedPnl: '0', time: f.broker.now }] : []),
    ]);
    // A tiny unpublished debit makes history urgent without approaching the loss threshold.
    f.broker.wallet = f.broker.wallet.minus('.0001');
    const count = f.broker.submits.length;
    let wallet = await monitoringTick(f);
    for (let tick = 0; tick < 10; tick++) {
      f.broker.now += 2000;
      wallet = await monitoringTick(f);
      expect(wallet.lastObservedAtMs).toBe(f.broker.now);
      expect(wallet.currentDay.riskLatched).toBe(false);
    }
    expect(f.broker.getUserTrades).toHaveBeenCalled();
    expect(wallet.status).toBe('reconciliation_required');
    expect(wallet.blockedReason).toContain('background ledger reconciliation failed');
    expect(wallet.trades.some(trade => trade.id === 'unowned-background-trade')).toBe(false);
    expect(Object.keys(f.broker.positions)).toHaveLength(5);
    expect(f.broker.submits).toHaveLength(count);
  });

  it('monitors held inventory from validated durable support after restart while metadata and orders remain pending', async () => {
    const f = await entered();
    await monitoringTick(f);
    f.broker.now += 2000;
    await monitoringTick(f);
    const stored = await readLiveWallet<any>(f.directory);
    expect(stored.monitoringSupport.metadata).not.toBeNull();
    expect(stored.monitoringSupport.orders).not.toBeNull();
    f.broker.getExchangeInfo = vi.fn(async () => never<Awaited<ReturnType<MonitoringBroker['getExchangeInfo']>>>());
    f.broker.getOpenOrders = vi.fn(async () => never<any[]>());
    f.broker.getOpenAlgoOrders = vi.fn(async () => never<any[]>());
    f.options.broker = new Proxy(f.broker, { get(target, key) {
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } }) as unknown as LiveBroker;
    const count = f.broker.submits.length;
    let wallet = await monitoringTick(f);
    for (let tick = 0; tick < 10; tick++) {
      f.broker.now += 2000;
      wallet = await monitoringTick(f);
      expect(wallet.lastObservedAtMs).toBe(f.broker.now);
      expect(wallet.currentDay.riskLatched).toBe(false);
    }
    expect(f.broker.getExchangeInfo).toHaveBeenCalledTimes(1);
    expect(f.broker.getOpenOrders).toHaveBeenCalledTimes(1);
    expect(f.broker.getOpenAlgoOrders).toHaveBeenCalledTimes(1);
    expect(wallet.status).toBe('reconciliation_required');
    expect(wallet.blockedReason).toMatch(/support.*pending|stale/i);
    expect(Object.keys(f.broker.positions)).toHaveLength(5);
    expect(f.broker.submits).toHaveLength(count);
    expect(wallet.sourceCursorMs).toBe(stored.sourceCursorMs);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Decimal } from '@prisma/client/runtime/library';
import type { LiveBroker } from '../../src/portfolio/live-broker';
import type { ConstantDirectionSourcePortfolioTargets } from '../../src/portfolio/source-constant-direction';
import { advanceLivePortfolio, LIVE_POLICY_ID, LIVE_SYMBOLS, type AdvanceLivePortfolioOptions, type LivePortfolioWallet } from '../../src/portfolio/live-service';
import { readLiveWallet, writeLiveWallet } from '../../src/portfolio/live-store';
const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
// These exercise fsync/atomic rename on the shared VPS, rather than mocking durability.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 30_000 });
const d = (x: string | number) => new Money(x);
const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });

class FakeBroker {
  identity = 'test-authenticated-recovery-account'; now = Date.parse('2026-10-16T12:00:00Z'); wallet = d('100'); price = '100'; dual = false;
  positions: Record<string, { q: Decimal; entry: Decimal }> = {};
  orders = new Map<string, any>(); trades: any[] = []; income: any[] = []; open: any[] = []; algo: any[] = [];
  submits: any[] = []; mode: 'full' | 'partial' | 'ambiguousAccepted' | 'ambiguousMissing' = 'full'; counter = 0;
  unrealized() { return Object.values(this.positions).reduce((sum, p) => sum.plus(p.q.mul(d(this.price).minus(p.entry))), d(0)); }
  async getAccount() {
    const equity = this.wallet.plus(this.unrealized());
    const gross = Object.values(this.positions).reduce((sum, p) => sum.plus(p.q.abs().mul(this.price)), d(0));
    return { canTrade: true, totalWalletBalance: this.wallet.toString(), totalUnrealizedProfit: this.unrealized().toString(),
      totalMarginBalance: equity.toString(), availableBalance: equity.minus(gross.div(10)).toString(),
      assets: [{ asset: 'USDT', walletBalance: this.wallet.toString(), unrealizedProfit: this.unrealized().toString() }] };
  }
  async getPositions() { return LIVE_SYMBOLS.map(symbol => ({ symbol, positionAmt: this.positions[symbol]?.q.toString() ?? '0',
    entryPrice: this.positions[symbol]?.entry.toString() ?? '0', markPrice: this.price, unRealizedProfit: '0',
    positionSide: 'BOTH', leverage: '10', marginType: 'cross', isolatedWallet: '0' })); }
  async getPositionMode() { return { dualSidePosition: this.dual }; }
  async getOpenOrders() { return this.open; }
  async getOpenAlgoOrders() { return this.algo; }
  async getMarkPrices() { return LIVE_SYMBOLS.map(symbol => ({ symbol, markPrice: this.price, time: this.now })); }
  async getTickerPrices() { return LIVE_SYMBOLS.map(symbol => ({ symbol, price: this.price, time: this.now })); }
  async getCommissionRate(symbol: string) { return { symbol, makerCommissionRate: '.0002', takerCommissionRate: '.0005' }; }
  async getSymbolConfiguration() { return LIVE_SYMBOLS.map(symbol => ({ symbol, marginType: 'CROSSED', leverage: '10' })); }
  async getExchangeInfo() { return { symbols: LIVE_SYMBOLS.map(symbol => ({ symbol, status: 'TRADING', contractType: 'PERPETUAL',
    quoteAsset: 'USDT', marginAsset: 'USDT', filters: [
      { filterType: 'LOT_SIZE', stepSize: '.01', minQty: '.01', maxQty: '1000' },
      { filterType: 'MARKET_LOT_SIZE', stepSize: '.01', minQty: '.01', maxQty: '1000' }, { filterType: 'MIN_NOTIONAL', notional: '1' },
    ] })) }; }
  async getIncome(query: any) { return this.income.filter(x => x.time >= query.startTime && x.time <= query.endTime); }
  async getUserTrades(query: any) { return this.trades.filter(x => x.symbol === query.symbol && x.time >= query.startTime && x.time <= query.endTime); }
  async queryOrder(symbol: string, clientId: string) {
    const order = this.orders.get(clientId);
    if (!order) throw Object.assign(new Error('Order missing'), { binanceCode: -2013 });
    return order;
  }
  async submitMarketOrder(request: any) {
    this.submits.push(request);
    if (this.mode === 'ambiguousMissing') throw Object.assign(new Error('Unknown submit outcome'), { ambiguous: true });
    const quantity = d(request.quantity).mul(this.mode === 'partial' ? '.5' : 1), side = request.side === 'BUY' ? 1 : -1;
    const old = this.positions[request.symbol] ?? { q: d(0), entry: d(0) }, signed = quantity.mul(side), next = old.q.plus(signed);
    const price = d(this.price), fee = quantity.mul(price).mul('.0005');
    const realized = side < 0 ? quantity.mul(price.minus(old.entry)) : d(0);
    const average = side > 0 ? old.q.mul(old.entry).plus(quantity.mul(price)).div(next) : old.entry;
    if (next.isZero()) delete this.positions[request.symbol]; else this.positions[request.symbol] = { q: next, entry: average };
    this.wallet = this.wallet.plus(realized).minus(fee);
    const id = ++this.counter, order = { symbol: request.symbol, clientOrderId: request.clientOrderId, orderId: String(id),
      status: this.mode === 'partial' ? 'PARTIALLY_FILLED' : 'FILLED', executedQty: quantity.toString() };
    this.orders.set(request.clientOrderId, order);
    this.trades.push({ symbol: request.symbol, id: String(id), orderId: String(id), qty: quantity.toString(), price: this.price,
      side: request.side, commissionAsset: 'USDT', commission: fee.toString(), realizedPnl: realized.toString(), time: this.now });
    this.income.push({ incomeType: 'COMMISSION', symbol: request.symbol, tranId: `c${id}`, asset: 'USDT', income: fee.negated().toString(), time: this.now });
    if (!realized.isZero()) this.income.push({ incomeType: 'REALIZED_PNL', symbol: request.symbol, tranId: `r${id}`, asset: 'USDT', income: realized.toString(), time: this.now });
    if (this.mode === 'ambiguousAccepted') { this.mode = 'full'; throw Object.assign(new Error('Unknown submit outcome'), { ambiguous: true }); }
    return order;
  }
  deposit(amount: string) {
    this.wallet = this.wallet.plus(amount);
    this.income.push({ incomeType: 'TRANSFER', symbol: '', tranId: `transfer${this.income.length}`, asset: 'USDT', income: amount, time: this.now });
  }
}
async function fixture() {
  const broker = new FakeBroker(), directory = await fs.mkdtemp(path.join(os.tmpdir(), 'authenticated-live-recovery-test-'));
  directories.push(directory); const receiptPath = path.join(directory, 'handoff.json');
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
async function enter(f: Awaited<ReturnType<typeof fixture>>) {
  await advanceLivePortfolio(f.options); f.broker.now = Date.parse('2026-10-17T00:00:00Z');
  return advanceLivePortfolio({ ...f.options, targets: targets(f.broker.now) });
}

/** Advance only the venue clock: every fill and cash row still comes from the broker. */
async function tick(f: Awaited<ReturnType<typeof fixture>>, options: Partial<AdvanceLivePortfolioOptions> = {}, elapsedMs = 2000) {
  f.broker.now += elapsedMs;
  return advanceLivePortfolio({ ...f.options, ...options });
}
async function closedAfterGap() {
  const f = await fixture();
  const before = await enter(f);
  const source = targets(f.broker.now);
  const closed = await tick(f, {}, 30_000);
  expect(closed.currentDay.latchReason).toBe('live_monitoring_gap');
  expect(Object.keys(f.broker.positions)).toHaveLength(0);
  expect(closed.trades).toHaveLength(10);
  return { ...f, before, closed, source };
}
async function stableTicks(f: Awaited<ReturnType<typeof fixture>>, options: Partial<AdvanceLivePortfolioOptions>, count = 50) {
  let wallet: LivePortfolioWallet | undefined;
  for (let i = 0; i < count; i++) wallet = await tick(f, options);
  return wallet!;
}

const recovering = (source: ConstantDirectionSourcePortfolioTargets): Partial<AdvanceLivePortfolioOptions> => ({
  autoRecoverTechnical: true, recoveryTargets: source, nonBlockingMonitoring: true,

});
const buys = (broker: FakeBroker) => broker.submits.filter(order => order.side === 'BUY');

// These are fault-injection checks against authenticated observations and durable
// local journals; no case sends an order to an exchange or writes a paper fill.
describe('automatic recovery from a technical live monitoring stop', () => {
  it('reconciles a technical close, observes30seconds of health and resumes outside the daily entry window', async () => {
    const f = await closedAfterGap();
    const anchor = f.closed.currentDay.anchorEquity, cursor = f.closed.sourceCursorMs;
    const sourceId = f.closed.lastSourceId, fees = f.closed.totalFees;
    const options = recovering(f.source);
    let wallet = await tick(f, options);
    expect(wallet.currentDay.riskLatched).toBe(true);
    expect(buys(f.broker)).toHaveLength(5);
    expect(wallet.technicalRecovery?.phase).not.toBe('resumed');
    // Recovery is assessed against present prices, beyond the old60second source gate.
    f.broker.price = '101';
    wallet = await stableTicks(f, options, 55);
    expect(f.broker.now - f.source.executeAtMs).toBeGreaterThan(60_000);
    expect(wallet.currentDay.riskLatched).toBe(false);
    expect(Object.keys(f.broker.positions)).toHaveLength(5);
    expect(wallet.technicalRecovery?.phase).toBe('resumed');
    expect(wallet.currentDay.anchorEquity).toBe(anchor);
    expect(wallet.sourceCursorMs).toBe(cursor);
    expect(wallet.lastSourceId).toBe(sourceId);
    expect(d(wallet.currentDay.worstNetPnl).lte(f.closed.currentDay.worstNetPnl)).toBe(true);
    expect(d(wallet.totalFees).gt(fees)).toBe(true);
    expect(wallet.trades).toHaveLength(f.broker.trades.length);
    expect(wallet.currentDay.netPnl).toBe(d(wallet.equity).minus(anchor).toString());
    expect(wallet.config.dailyLossLimitUsd).toBe('12');
    expect(wallet.config.softLossThresholdUsd).toBe('-5.9');
    expect(wallet.config.closeBufferUsd).toBe('6.1');
  });

  it('requires a continuous healthy period and restarts the streak after another failed observation', async () => {
    const f = await closedAfterGap(), options = recovering(f.source);
    await stableTicks(f, options, 10); //20seconds cannot authorize re-entry.
    expect(buys(f.broker)).toHaveLength(5);
    const account = f.broker.getAccount.bind(f.broker);
    f.broker.getAccount = async () => { throw new Error('Authenticated account unavailable again'); };
    await tick(f, options);
    f.broker.getAccount = account;
    await stableTicks(f, options, 10);
    expect(buys(f.broker)).toHaveLength(5);
    const resumed = await stableTicks(f, options, 45);
    expect(resumed.currentDay.riskLatched).toBe(false);
    expect(Object.keys(f.broker.positions)).toHaveLength(5);
  });

  it('does not mistake a long unobserved flat interval for30seconds of continuous health', async () => {
    const f = await closedAfterGap(), options = recovering(f.source);
    await tick(f, options);
    await tick(f, options, 90_000);
    expect(buys(f.broker)).toHaveLength(5);
    await stableTicks(f, options, 8);
    expect(buys(f.broker)).toHaveLength(5);
  });

  it('persists the recovery incident and individual order intents across restart without duplicate entries', async () => {
    const f = await closedAfterGap(), options = recovering(f.source);
    let wallet = await tick(f, options);
    for (let i = 0; i < 40 && buys(f.broker).length === 5; i++) wallet = await tick(f, options);
    expect(buys(f.broker).length).toBeGreaterThan(5);
    const incident = wallet.technicalRecovery?.incidentId;
    expect(incident).toBeTruthy();
    const beforeRestartIds = f.broker.submits.map(order => order.clientOrderId);
    f.options.broker = new Proxy(f.broker, { get(target, key) {
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } }) as unknown as LiveBroker;
    wallet = await stableTicks(f, options, 45);
    expect(wallet.technicalRecovery?.incidentId).toBe(incident);
    expect(buys(f.broker)).toHaveLength(10);
    expect(new Set(f.broker.submits.map(order => order.clientOrderId)).size).toBe(f.broker.submits.length);
    expect(beforeRestartIds.every(id => f.broker.submits.some(order => order.clientOrderId === id))).toBe(true);
    const count = f.broker.submits.length;
    await stableTicks(f, options, 10);
    expect(f.broker.submits).toHaveLength(count);
    expect((await readLiveWallet<any>(f.directory)).sourceCursorMs).toBe(f.closed.sourceCursorMs);
  });

  it.each(['90', '80'])('never clears a simultaneous technical and financial stop at price%s', async price => {
    const f = await fixture(); await enter(f);
    const source = targets(f.broker.now);
    f.broker.price = price;
    const stopped = await tick(f, {}, 30_000);
    expect(stopped.currentDay.riskLatched).toBe(true);
    expect(Object.keys(f.broker.positions)).toHaveLength(0);
    expect(d(stopped.currentDay.netPnl).lte('-5.9')).toBe(true);
    const count = buys(f.broker).length;
    const final = await stableTicks(f, recovering(source), 55);
    expect(final.currentDay.riskLatched).toBe(true);
    expect(buys(f.broker)).toHaveLength(count);
    expect(final.currentDay.latchReason).not.toBe('live_monitoring_gap');
    if (price === '80') expect(d(final.currentDay.breachUsd).gt(0)).toBe(true);
  });

  it('keeps a simultaneous maintenance margin stop sticky after the technical close makes the account flat', async () => {
    const f = await fixture(); await enter(f);
    const source = targets(f.broker.now), account = f.broker.getAccount.bind(f.broker);
    f.broker.getAccount = async () => ({ ...await account(), totalMaintMargin: '1000' });
    const stopped = await tick(f, {}, 30_000);
    expect(Object.keys(f.broker.positions)).toHaveLength(0);
    expect(stopped.currentDay.latchReason).toBe('maintenance_margin_reserve');
    f.broker.getAccount = account;
    const final = await stableTicks(f, recovering(source), 55);
    expect(final.currentDay.riskLatched).toBe(true);
    expect(final.currentDay.stopReasons).toContain('maintenance_margin_reserve');
    expect(buys(f.broker)).toHaveLength(5);
  });

  it('retains a missing authenticated day anchor instead of relabeling it as a recoverable technical stop', async () => {
    const f = await fixture(); await enter(f);
    f.broker.now = Date.parse('2026-10-17T17:01:00Z');
    const stopped = await advanceLivePortfolio({ ...f.options, maxMonitoringGapMs: 86_400_000 });
    expect(stopped.currentDay.anchorQuality).toBe('missing_boundary');
    const final = await stableTicks(f, recovering(targets(Date.parse('2026-10-17T00:00:00Z'))), 55);
    expect(final.currentDay.riskLatched).toBe(true);
    expect(final.currentDay.anchorQuality).toBe('missing_boundary');
    expect(buys(f.broker)).toHaveLength(5);
  });

  it.each(['income_failure', 'unpublished_cash', 'foreign_order', 'foreign_position', 'unknown_post'] as const)(
    'blocks re-entry during%s without writing invented trade records', async condition => {
      const f = await closedAfterGap();
      const stored = await readLiveWallet<any>(f.directory);
      if (condition === 'income_failure') f.broker.getIncome = async () => { throw new Error('Income unavailable'); };
      if (condition === 'unpublished_cash') f.broker.wallet = f.broker.wallet.minus('1');
      if (condition === 'foreign_order') f.broker.open = [{ symbol: 'BTCUSDT', clientOrderId: 'another-strategy' }];
      if (condition === 'foreign_position') f.broker.positions.BTCUSDT = { q: d('.01'), entry: d('100') };
      if (condition === 'unknown_post') {
        stored.intents.push({ clientOrderId: 'cd15_unresolved_recovery', sourceId: 'unknown', symbol: 'BTCUSDT', quantity: '.1', reduceOnly: false,
          createdAtMs: f.broker.now, submittedOnce: true, status: 'UNKNOWN', orderId: null, executedQty: '0', observedFillQty: '0', lastError: 'Unknown submit outcome' });
        await writeLiveWallet(f.directory, stored);
      }
      const before = buys(f.broker).length, trades = f.broker.trades.length;
      const final = await stableTicks(f, recovering(f.source), 55);
      expect(buys(f.broker)).toHaveLength(before);
      expect(final.currentDay.riskLatched).toBe(true);
      expect(final.trades).toHaveLength(trades);
      expect(final.technicalRecovery?.phase).not.toBe('resumed');
    });

  it.each(['missing', 'old_day', 'future_known', 'negative_weight'] as const)(
    'refuses a%s recovery target while keeping the daily source cursor intact', async condition => {
      const f = await closedAfterGap();
      const source = structuredClone(f.source);
      if (condition === 'old_day') { source.executeAtMs -= 86_400_000; source.knownAtMs -= 86_400_000; source.labelTimeMs -= 86_400_000; }
      if (condition === 'future_known') source.knownAtMs = f.broker.now + 86_400_000;
      if (condition === 'negative_weight') source.decimalWeights!.BTCUSDT = '-.2';
      const options = recovering(source);
      if (condition === 'missing') options.recoveryTargets = null as any;
      const final = await stableTicks(f, options, 55);
      expect(final.currentDay.riskLatched).toBe(true);
      expect(buys(f.broker)).toHaveLength(5);
      expect(final.sourceCursorMs).toBe(f.closed.sourceCursorMs);
      expect(final.currentDay.anchorEquity).toBe(f.closed.currentDay.anchorEquity);
    });

  it('never retries an unknown recovery POST after the incident plan is persisted', async () => {
    const f = await closedAfterGap(), options = recovering(f.source);
    f.broker.mode = 'ambiguousMissing';
    const first = await stableTicks(f, options, 45);
    expect(buys(f.broker)).toHaveLength(6);
    expect(first.status).toBe('reconciliation_required');
    const unknown = first.intents.find(intent => intent.status === 'UNKNOWN');
    expect(unknown?.submittedOnce).toBe(true);
    f.options.broker = new Proxy(f.broker, { get(target, key) {
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } }) as unknown as LiveBroker;
    const afterRestart = await stableTicks(f, options, 30);
    expect(buys(f.broker)).toHaveLength(6);
    expect(afterRestart.intents.filter(intent => intent.clientOrderId === unknown!.clientOrderId)).toHaveLength(1);
    expect(afterRestart.trades).toHaveLength(10);
    expect(afterRestart.technicalRecovery?.phase).not.toBe('resumed');
  });

  it('uses another durable incident for a later technical outage without resetting the daily budget', async () => {
    const f = await closedAfterGap(), options = recovering(f.source);
    const resumed = await stableTicks(f, options, 55);
    expect(resumed.technicalRecovery?.phase).toBe('resumed');
    const firstIncident = resumed.technicalRecovery?.incidentId;
    const secondStop = await tick(f, options, 30_000);
    expect(secondStop.currentDay.riskLatched).toBe(true);
    expect(Object.keys(f.broker.positions)).toHaveLength(0);
    const final = await stableTicks(f, options, 55);
    expect(final.technicalRecovery?.phase).toBe('resumed');
    expect(final.technicalRecovery?.incidentId).not.toBe(firstIncident);
    expect(buys(f.broker)).toHaveLength(15);
    expect(final.currentDay.anchorEquity).toBe(f.closed.currentDay.anchorEquity);
    expect(final.sourceCursorMs).toBe(f.closed.sourceCursorMs);
    expect(new Set(f.broker.submits.map(order => order.clientOrderId)).size).toBe(f.broker.submits.length);
  });


  it('does not clear a legacy technical latch whose persisted worst loss already crossed the financial stop', async () => {
    const f = await closedAfterGap();
    const stored = await readLiveWallet<any>(f.directory);
    delete stored.currentDay.stopReasons;
    delete stored.technicalRecovery;
    stored.currentDay.worstNetPnl = '-9';
    await writeLiveWallet(f.directory, stored);
    const final = await stableTicks(f, recovering(f.source), 55);
    expect(final.currentDay.riskLatched).toBe(true);
    expect(final.currentDay.worstNetPnl).toBe('-9');
    expect(buys(f.broker)).toHaveLength(5);
  });

  it('carries a flat technical pause across ICT midnight and recovers against the new daily anchor', async () => {
    const f = await closedAfterGap(), options = recovering(f.source);
    f.broker.now = Date.parse('2026-10-17T16:59:56Z');
    await tick(f, options);
    const midnight = await tick(f, options);
    expect(midnight.currentDay.day).toBe('2026-10-18');
    expect(midnight.currentDay.riskLatched).toBe(true);
    expect(midnight.days.at(-1)?.day).toBe('2026-10-17');
    const anchor = midnight.currentDay.anchorEquity;
    const final = await stableTicks(f, options, 55);
    expect(final.technicalRecovery?.phase).toBe('resumed');
    expect(final.currentDay.anchorEquity).toBe(anchor);
    expect(final.sourceCursorMs).toBe(f.closed.sourceCursorMs);
    expect(buys(f.broker)).toHaveLength(10);
  });

  it('keeps submitted recovery legs awaiting late ledger publication past the entry deadline without another POST', async () => {
    const f = await closedAfterGap(), options = recovering(f.source);
    let wallet = await tick(f, options);
    for (let i = 0; i < 55 && buys(f.broker).length < 10; i++) wallet = await tick(f, options);
    expect(buys(f.broker)).toHaveLength(10);
    const income = f.broker.getIncome.bind(f.broker), trades = f.broker.getUserTrades.bind(f.broker);
    f.broker.getIncome = async () => { throw new Error('Ledger delayed'); };
    f.broker.getUserTrades = async () => { throw new Error('Ledger delayed'); };
    const count = f.broker.submits.length;
    wallet = await stableTicks(f, options, 40);
    expect(wallet.pendingSourcePlan?.nextIndex).toBe(5);
    expect(wallet.technicalRecovery?.phase).toBe('resuming');
    expect(f.broker.submits).toHaveLength(count);
    f.broker.getIncome = income; f.broker.getUserTrades = trades;
    wallet = await stableTicks(f, options, 20);
    expect(wallet.technicalRecovery?.phase).toBe('resumed');
    expect(f.broker.submits).toHaveLength(count);
  });
});

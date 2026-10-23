import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Decimal } from '@prisma/client/runtime/library';
import type { LiveBroker } from '../../src/portfolio/live-broker';
import type { ConstantDirectionSourcePortfolioTargets } from '../../src/portfolio/source-constant-direction';
import { advanceLivePortfolio, LIVE_CONFIG, LIVE_POLICY_ID, LIVE_SYMBOLS, type AdvanceLivePortfolioOptions } from '../../src/portfolio/live-service';
import { readLiveWallet, writeLiveWallet } from '../../src/portfolio/live-store';
const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
// These exercise fsync/atomic rename on the shared VPS, rather than mocking durability.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
const d = (x: string | number) => new Money(x);
const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });

class FakeBroker {
  identity = 'test-authenticated-account'; now = Date.parse('2026-10-16T12:00:00Z'); wallet = d('100'); price = '100'; dual = false;
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
  const broker = new FakeBroker(), directory = await fs.mkdtemp(path.join(os.tmpdir(), 'authenticated-live-test-'));
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
describe('authenticated constant-direction portfolio orchestration', () => {
  it('tightens only the exact legacy15u budget without rebasing money, source or fills', async () => {
    const f = await fixture(), old = await enter(f);
    old.config = { ...old.config, dailyLossLimitUsd: '15', softLossThresholdUsd: '-8.9' };
    await writeLiveWallet(f.directory, old); f.broker.now += 2000;
    const before = JSON.parse(JSON.stringify(old)), orders = f.broker.submits.length;
    const migrated = await advanceLivePortfolio(f.options);
    expect(migrated.config).toEqual({ ...before.config, dailyLossLimitUsd: '12', softLossThresholdUsd: '-5.9' });
    for (const key of ['startedAtMs', 'bootstrapAccountEquity', 'netCashflow', 'totalFees', 'fundingPnl', 'realizedPnl',
      'trades', 'incomes', 'processedTradeIds', 'processedIncomeIds', 'intents', 'sourceCursorMs', 'lastSourceId', 'days'] as const) {
      expect(migrated[key]).toEqual(before[key]);
    }
    expect(migrated.currentDay.anchorEquity).toBe(before.currentDay.anchorEquity);
    expect(migrated.currentDay.worstNetPnl).toBe(before.currentDay.worstNetPnl);
    expect(migrated.riskBudgetChanges).toEqual([{ revision: 'DAILY12_20261019', changedAtMs: f.broker.now,
      day: before.currentDay.day, fromDailyLossLimitUsd: '15', toDailyLossLimitUsd: '12',
      fromSoftLossThresholdUsd: '-8.9', toSoftLossThresholdUsd: '-5.9', closeBufferUsd: '6.1',
      dayAnchorEquity: before.currentDay.anchorEquity, worstNetPnlBeforeChange: before.currentDay.worstNetPnl }]);
    const again = await advanceLivePortfolio(f.options);
    expect(again.riskBudgetChanges).toEqual(migrated.riskBudgetChanges);
    expect(f.broker.submits).toHaveLength(orders);
  });
  it('keeps the new12u limit durable on a read failure and rejects restoring15u after migration', async () => {
    const f = await fixture(), old = await advanceLivePortfolio(f.options);
    old.config = { ...old.config, dailyLossLimitUsd: '15', softLossThresholdUsd: '-8.9' };
    await writeLiveWallet(f.directory, old);
    vi.spyOn(f.broker, 'getAccount').mockRejectedValue(new Error('network read failed'));
    const stopped = await advanceLivePortfolio(f.options);
    expect(stopped.config.dailyLossLimitUsd).toBe('12');
    const persisted = await readLiveWallet<any>(f.directory);
    expect(persisted.config.softLossThresholdUsd).toBe('-5.9'); expect(persisted.riskBudgetChanges).toHaveLength(1);
    persisted.config.dailyLossLimitUsd = '15'; persisted.config.softLossThresholdUsd = '-8.9';
    await writeLiveWallet(f.directory, persisted);
    await expect(advanceLivePortfolio(f.options)).rejects.toThrow('identity/policy/handoff mismatch');
    expect(f.broker.submits).toHaveLength(0);
  });
  it('does not accept another cap, reserve or capital mismatch as the authorized migration', async () => {
    const f = await fixture(), original = await advanceLivePortfolio(f.options);
    for (const patch of [{ dailyLossLimitUsd: '13', softLossThresholdUsd: '-6.9' },
      { dailyLossLimitUsd: '15', softLossThresholdUsd: '-8.9', closeBufferUsd: '5' },
      { dailyLossLimitUsd: '15', softLossThresholdUsd: '-8.9', initialCash: '101' }]) {
      const altered = { ...original, config: { ...original.config, ...patch } };
      await writeLiveWallet(f.directory, altered);
      await expect(advanceLivePortfolio(f.options)).rejects.toThrow('identity/policy/handoff mismatch');
      expect((await readLiveWallet<any>(f.directory)).riskBudgetChanges).toBeUndefined();
    }
    expect(f.broker.submits).toHaveLength(0);
  });
  it('retains a monetary latch while tightening the budget, even if current equity recovered', async () => {
    const f = await fixture(), old = await advanceLivePortfolio(f.options);
    old.config = { ...old.config, dailyLossLimitUsd: '15', softLossThresholdUsd: '-8.9' };
    old.currentDay.riskLatched = true; old.currentDay.latchReason = 'fixed_daily_loss_close_reserve';
    old.currentDay.stopReasons = ['fixed_daily_loss_close_reserve']; old.currentDay.worstNetPnl = '-9';
    await writeLiveWallet(f.directory, old);
    const migrated = await advanceLivePortfolio({ ...f.options, autoRecoverTechnical: true });
    expect(migrated.currentDay.riskLatched).toBe(true);
    expect(migrated.currentDay.latchReason).toBe('fixed_daily_loss_close_reserve');
    expect(migrated.currentDay.worstNetPnl).toBe('-9'); expect(f.broker.submits).toHaveLength(0);
  });
  it('does not erase a same-day loss that already exceeds the newly tightened12u cap', async () => {
    const f = await fixture(), old = await advanceLivePortfolio(f.options);
    old.config = { ...old.config, dailyLossLimitUsd: '15', softLossThresholdUsd: '-8.9' };
    old.currentDay.worstNetPnl = '-12.5'; await writeLiveWallet(f.directory, old);
    const migrated = await advanceLivePortfolio({ ...f.options, autoRecoverTechnical: true });
    expect(migrated.currentDay.riskLatched).toBe(true);
    expect(migrated.currentDay.latchReason).toBe('fixed_daily_loss_observed');
    expect(migrated.currentDay.breachUsd).toBe('0.5'); expect(migrated.currentDay.worstNetPnl).toBe('-12.5');
    expect(f.broker.submits).toHaveLength(0);
  });
  it('starts closing around5.9u plus execution reserve with the same6.1u safety buffer', async () => {
    const f = await fixture(); await enter(f); f.broker.price = '93'; f.broker.now += 2000;
    const stopped = await advanceLivePortfolio(f.options);
    expect(stopped.currentDay.riskLatched).toBe(true);
    expect(stopped.currentDay.latchReason).toBe('fixed_daily_loss_close_reserve');
    expect(stopped.config.dailyLossLimitUsd).toBe('12'); expect(stopped.config.closeBufferUsd).toBe('6.1');
    expect(f.broker.submits.some(order => order.reduceOnly)).toBe(true);
    expect(Object.values(stopped.positions).every(position => d(position.quantity).isZero())).toBe(true);
  });
  it('cannot auto-recover a technical stop after the same-day loss already crossed the new soft threshold', async () => {
    const f = await fixture(), old = await advanceLivePortfolio(f.options);
    old.config = { ...old.config, dailyLossLimitUsd: '15', softLossThresholdUsd: '-8.9' };
    old.currentDay.worstNetPnl = '-6.1'; old.currentDay.riskLatched = true;
    old.currentDay.latchReason = 'live_monitoring_gap'; old.currentDay.stopReasons = ['live_monitoring_gap'];
    await writeLiveWallet(f.directory, old);
    const migrated = await advanceLivePortfolio({ ...f.options, autoRecoverTechnical: true });
    expect(migrated.currentDay.riskLatched).toBe(true);
    expect(migrated.currentDay.latchReason).toBe('fixed_daily_loss_close_reserve');
    expect(migrated.currentDay.stopReasons).toContain('live_monitoring_gap');
    expect(migrated.currentDay.worstNetPnl).toBe('-6.1'); expect(f.broker.submits).toHaveLength(0);
  });
  it('does not backdate the new soft threshold into a completed prior ICT day during migration', async () => {
    const f = await fixture(), old = await advanceLivePortfolio(f.options);
    old.config = { ...old.config, dailyLossLimitUsd: '15', softLossThresholdUsd: '-8.9' };
    old.currentDay.worstNetPnl = '-6.1'; await writeLiveWallet(f.directory, old);
    f.broker.now += 86_400_000;
    const migrated = await advanceLivePortfolio(f.options);
    expect(migrated.currentDay.riskLatched).toBe(false);
    expect(migrated.days[0].worstNetPnl).toBe('-6.1'); expect(migrated.days[0].riskLatched).toBe(false);
    expect(migrated.currentDay.anchorEquity).toBe(old.currentDay.anchorEquity);
  });
  it('binds the receipt/account and allocates100 without writing paper or synthetic fills', async () => {
    const f = await fixture(); f.broker.wallet = d('150'); const wallet = await advanceLivePortfolio(f.options);
    expect(wallet.equity).toBe('100'); expect(wallet.accountEquity).toBe('150'); expect(wallet.trades).toEqual([]);
    expect(wallet.config.dailyLossLimitUsd).toBe('12'); expect(wallet.config.closeBufferUsd).toBe('6.1');
    expect(wallet.config.softLossThresholdUsd).toBe('-5.9'); expect(f.broker.submits).toHaveLength(0);
    await expect(advanceLivePortfolio({ ...f.options, accountIdentity: 'another-account-identity' })).rejects.toThrow('Broker identity');
  });
  it('rejects bootstrap exposure, insufficient capital, foreign orders and hedge mode', async () => {
    const f = await fixture(); f.broker.positions.BTCUSDT = { q: d('.1'), entry: d('100') };
    await expect(advanceLivePortfolio(f.options)).rejects.toThrow('clean exchange'); delete f.broker.positions.BTCUSDT;
    f.broker.open = [{ clientOrderId: 'someone-else' }]; await expect(advanceLivePortfolio(f.options)).rejects.toThrow('clean exchange');
    f.broker.open = []; f.broker.wallet = d('99'); await expect(advanceLivePortfolio(f.options)).rejects.toThrow('100u');
    f.broker.wallet = d('100'); f.broker.dual = true; await expect(advanceLivePortfolio(f.options)).rejects.toThrow('ONE_WAY');
  });
  it('records actual fills/commissions and deduplicates on restart and repeated UTC source', async () => {
    const f = await fixture(), first = await enter(f), count = f.broker.submits.length;
    expect(first.blockedReason).toBeNull(); expect(count).toBeGreaterThan(0); expect(first.trades).toHaveLength(count);
    expect(d(first.totalFees).gt(0)).toBe(true); expect(first.incomes).toHaveLength(count);
    const again = await advanceLivePortfolio({ ...f.options, targets: targets(f.broker.now) });
    expect(f.broker.submits).toHaveLength(count); expect(again.totalFees).toBe(first.totalFees); expect(again.equity).toBe(first.equity);
    expect(f.broker.submits.every(x => x.positionSide === 'BOTH' && x.clientOrderId.startsWith('cd15_'))).toBe(true);
  });
  it('never resubmits an ambiguous absent order after restart', async () => {
    const f = await fixture(); f.broker.mode = 'ambiguousMissing'; const first = await enter(f);
    expect(first.status).toBe('reconciliation_required'); expect(f.broker.submits).toHaveLength(1);
    expect(first.intents[0].submittedOnce).toBe(true);
    const second = await advanceLivePortfolio({ ...f.options, targets: targets(f.broker.now) });
    expect(second.status).toBe('reconciliation_required'); expect(f.broker.submits).toHaveLength(1);
  });
  it('retires a provably unsubmitted prepared intent after a failed preflight GET without poisoning the next UTC source', async () => {
    const f = await fixture(); await advanceLivePortfolio(f.options);
    const start = Date.parse('2026-10-17T00:00:00Z'); f.broker.now = start;
    const query = vi.spyOn(f.broker, 'queryOrder'); query.mockRejectedValueOnce(new Error('Preflight GET connection timed out'));
    const failed = await advanceLivePortfolio({ ...f.options, targets: targets(start) });
    expect(failed.status).toBe('reconciliation_required'); expect(f.broker.submits).toHaveLength(0);
    expect(failed.intents[0]).toMatchObject({ status: 'PREPARED', submittedOnce: false, orderId: null,
      executedQty: '0', observedFillQty: '0' });
    const originalId = failed.intents[0].clientOrderId;
    f.broker.now += 2000; const reconciled = await advanceLivePortfolio(f.options);
    expect(reconciled.intents[0]).toMatchObject({ clientOrderId: originalId, status: 'REJECTED', submittedOnce: false });
    expect(reconciled.intents[0].lastError).toContain('before submission'); expect(reconciled.status).toBe('flat');
    expect(reconciled.sourceCursorMs).toBe(start); expect(f.broker.submits).toHaveLength(0);
    await advanceLivePortfolio({ ...f.options, targets: targets(start) }); expect(f.broker.submits).toHaveLength(0);
    f.broker.now = start + 86_400_000;
    const next = await advanceLivePortfolio({ ...f.options, targets: targets(f.broker.now) });
    expect(next.status).toBe('active'); expect(f.broker.submits.length).toBeGreaterThan(0);
    expect(f.broker.submits.some(request => request.clientOrderId === originalId)).toBe(false);
    expect(next.intents.find(intent => intent.clientOrderId === originalId)?.status).toBe('REJECTED');
  });
  it('retires an unsubmitted prepared intent through the real background query lane without replaying its source', async () => {
    const f = await fixture(); await advanceLivePortfolio(f.options);
    const start = Date.parse('2026-10-17T00:00:00Z'); f.broker.now = start;
    vi.spyOn(f.broker, 'queryOrder').mockRejectedValueOnce(new Error('Preflight GET connection timed out'));
    const failed = await advanceLivePortfolio({ ...f.options, targets: targets(start) });
    const originalId = failed.intents[0].clientOrderId;
    let recovered = failed;
    for (let tick = 0; tick < 5 && recovered.intents[0].status !== 'REJECTED'; tick++) {
      f.broker.now += 2000;
      recovered = await advanceLivePortfolio({ ...f.options, nonBlockingMonitoring: true });
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    expect(recovered.intents[0]).toMatchObject({ clientOrderId: originalId, status: 'REJECTED', submittedOnce: false,
      orderId: null, executedQty: '0', observedFillQty: '0' });
    expect(recovered.status).toBe('flat'); expect(recovered.sourceCursorMs).toBe(start);
    expect(f.broker.submits).toHaveLength(0);
    f.broker.now = start + 86_400_000;
    for (let tick = 0; tick < 8 && !f.broker.submits.length; tick++) {
      recovered = await advanceLivePortfolio({ ...f.options, nonBlockingMonitoring: true, targets: targets(start + 86_400_000) });
      await new Promise<void>(resolve => setImmediate(resolve)); f.broker.now += 2000;
    }
    expect(f.broker.submits.length).toBeGreaterThan(0);
    expect(f.broker.submits.some(request => request.clientOrderId === originalId)).toBe(false);
    expect(recovered.intents.find(intent => intent.clientOrderId === originalId)?.status).toBe('REJECTED');
  });
  it('keeps an ambiguous absent POST unresolved when background order queries return not-found', async () => {
    const f = await fixture(); f.broker.mode = 'ambiguousMissing'; const first = await enter(f);
    const originalId = first.intents[0].clientOrderId;
    expect(first.intents[0]).toMatchObject({ status: 'UNKNOWN', submittedOnce: true });
    let waiting = first;
    for (let tick = 0; tick < 4; tick++) {
      f.broker.now += 2000;
      waiting = await advanceLivePortfolio({ ...f.options, nonBlockingMonitoring: true });
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    expect(waiting.intents[0]).toMatchObject({ clientOrderId: originalId, status: 'UNKNOWN', submittedOnce: true });
    expect(waiting.status).toBe('reconciliation_required'); expect(f.broker.submits).toHaveLength(1);
    expect(waiting.intents[0].lastError).toContain('manual reconciliation');
  });
  it('recovers an accepted but unacknowledged POST by client ID and actual trades', async () => {
    const f = await fixture(); f.broker.mode = 'ambiguousAccepted'; const wallet = await enter(f);
    expect(wallet.status).toBe('active'); expect(wallet.trades.length).toBeGreaterThan(0);
    expect(new Set(f.broker.submits.map(x => x.clientOrderId)).size).toBe(f.broker.submits.length);
    expect(wallet.intents.every(x => x.status === 'FILLED' && d(x.observedFillQty).eq(x.executedQty))).toBe(true);
  });
  it('blocks the rest of a multi-asset plan after a partial fill', async () => {
    const f = await fixture(); f.broker.mode = 'partial'; const wallet = await enter(f);
    expect(f.broker.submits).toHaveLength(1); expect(wallet.status).toBe('reconciliation_required');
    expect(wallet.intents[0].status).toBe('PARTIALLY_FILLED'); expect(wallet.trades).toHaveLength(1);
    await advanceLivePortfolio(f.options); expect(f.broker.submits).toHaveLength(1);
  });
  it('detects external position changes and account/income coverage gaps', async () => {
    const f = await fixture(); await enter(f); const count = f.broker.submits.length;
    f.broker.positions.BTCUSDT.q = f.broker.positions.BTCUSDT.q.plus(1);
    const mismatch = await advanceLivePortfolio(f.options);
    expect(mismatch.blockedReason).toContain('position mismatch'); expect(f.broker.submits).toHaveLength(count);
    f.broker.positions.BTCUSDT.q = f.broker.positions.BTCUSDT.q.minus(1); f.broker.wallet = f.broker.wallet.plus('1');
    const missing = await advanceLivePortfolio(f.options); expect(missing.blockedReason).toContain('income coverage mismatch');
  });
  it('keeps deposits out of profit/sizing and closes owned positions at the preserved soft threshold', async () => {
    const f = await fixture(); await enter(f); f.broker.now += 1000; f.broker.price = '90'; f.broker.deposit('30');
    const wallet = await advanceLivePortfolio(f.options);
    expect(wallet.netCashflow).toBe('30'); expect(d(wallet.netPnl).lt(-5.9)).toBe(true);
    expect(wallet.currentDay.riskLatched).toBe(true); expect(wallet.positions).toEqual({});
    expect(wallet.intents.some(x => x.reduceOnly)).toBe(true); expect(wallet.currentDay.breachUsd).toBe('0');
    const count = f.broker.submits.length; await advanceLivePortfolio({ ...f.options, targets: targets(f.broker.now - 1000) });
    expect(f.broker.submits).toHaveLength(count);
  });
  it('does not hide observed overshoot beyond12u', async () => {
    const f = await fixture(); await enter(f); f.broker.now += 1000; f.broker.price = '75';
    const wallet = await advanceLivePortfolio(f.options);
    expect(d(wallet.currentDay.breachUsd).gt(0)).toBe(true); expect(wallet.positions).toEqual({});
    expect(wallet.continuousRiskGuarantee).toBe(false);
  });
  it('latches a monitoring gap and a missing held-inventory ICT boundary', async () => {
    const f = await fixture(); await enter(f); f.broker.now += 30_000;
    const gap = await advanceLivePortfolio(f.options); expect(gap.currentDay.latchReason).toBe('live_monitoring_gap'); expect(gap.positions).toEqual({});
    const g = await fixture(); await enter(g); g.broker.now = Date.parse('2026-10-17T17:01:00Z');
    const boundary = await advanceLivePortfolio({ ...g.options, maxMonitoringGapMs: 86_400_000 });
    expect(boundary.currentDay.anchorQuality).toBe('missing_boundary'); expect(boundary.currentDay.riskLatched).toBe(true);
    expect(boundary.positions).toEqual({});
  });
  it('never invents a late UTC entry and never replays an old row after a day reset', async () => {
    const f = await fixture(); await advanceLivePortfolio(f.options); f.broker.now = Date.parse('2026-10-17T00:02:00Z');
    const wallet = await advanceLivePortfolio({ ...f.options, targets: targets(Date.parse('2026-10-17T00:00:00Z')) });
    expect(wallet.status).toBe('reconciliation_required'); expect(wallet.sourceCursorMs).toBe(Date.parse('2026-10-17T00:00:00Z'));
    expect(f.broker.submits).toHaveLength(0); f.broker.now = Date.parse('2026-10-17T17:00:00Z');
    await advanceLivePortfolio({ ...f.options, targets: targets(Date.parse('2026-10-17T00:00:00Z')) }); expect(f.broker.submits).toHaveLength(0);
  });
  it('does not resume a persisted prepared/submitting intent by resending it', async () => {
    const f = await fixture(); const wallet = await advanceLivePortfolio(f.options);
    wallet.intents.push({ clientOrderId: 'cd15_crash_before_post', sourceId: 'crash', symbol: 'BTCUSDT', quantity: '.2', reduceOnly: false,
      createdAtMs: f.broker.now, submittedOnce: true, status: 'SUBMITTING', orderId: null, executedQty: '0', observedFillQty: '0', lastError: null });
    await writeLiveWallet(f.directory, wallet);
    const result = await advanceLivePortfolio(f.options); expect(result.status).toBe('reconciliation_required'); expect(f.broker.submits).toHaveLength(0);
    expect((await readLiveWallet<any>(f.directory)).intents).toHaveLength(1);
  });
  it('requires authenticated leverage/margin configuration and fresh venue prices', async () => {
    const f = await fixture();
    f.broker.getSymbolConfiguration = async () => LIVE_SYMBOLS.map(symbol => ({ symbol, marginType: 'CROSSED', leverage: '20' }));
    await expect(advanceLivePortfolio(f.options)).rejects.toThrow('leverage/margin configuration');
    const g = await fixture();
    g.broker.getMarkPrices = async () => LIVE_SYMBOLS.map(symbol => ({ symbol, markPrice: g.broker.price, time: g.broker.now - 6_000 }));
    await expect(advanceLivePortfolio(g.options)).rejects.toThrow('Stale venue quote');
  });
  it('refuses a changed handoff receipt after a wallet has been created', async () => {
    const f = await fixture(); await advanceLivePortfolio(f.options);
    await fs.appendFile(f.options.handoff.receiptPath, ' ');
    await expect(advanceLivePortfolio(f.options)).rejects.toThrow('handoff mismatch'); expect(f.broker.submits).toHaveLength(0);
  });
  it('binds an explicitly authorized31.47744546u allocation and keeps the daily12u budget', async () => {
    const f = await fixture(); f.broker.wallet = d('31.47744546');
    const wallet = await advanceLivePortfolio({ ...f.options, initialCapital: '31.47744546' });
    expect(wallet.equity).toBe('31.47744546'); expect(wallet.config.initialCash).toBe('31.47744546');
    expect(wallet.config.dailyLossLimitUsd).toBe('12'); expect(wallet.config.softLossThresholdUsd).toBe('-5.9');
    await expect(advanceLivePortfolio(f.options)).rejects.toThrow('policy/handoff mismatch');
  });
  it('continues actual owned risk reductions while an authenticated funding debit awaits income publication', async () => {
    const f = await fixture(); await enter(f); f.broker.now += 1000;
    f.broker.wallet = f.broker.wallet.minus('10');
    f.broker.income.push({ incomeType: 'FUNDING_FEE', symbol: 'BTCUSDT', asset: 'USDT', tranId: 'late-funding', income: '-10', time: f.broker.now });
    const complete = f.broker.getIncome.bind(f.broker);
    f.broker.getIncome = async query => (await complete(query)).filter(x => x.tranId !== 'late-funding');
    const pending = await advanceLivePortfolio(f.options);
    expect(pending.currentDay.riskLatched).toBe(true); expect(pending.positions).toEqual({});
    expect(pending.equityQuality).toBe('conservative_pending_income'); expect(pending.unreconciledWalletDelta).toBe('-10');
    expect(d(pending.netPnl).lt('-10')).toBe(true);
    f.broker.getIncome = complete;
    const settled = await advanceLivePortfolio(f.options);
    expect(settled.equityQuality).toBe('reconciled'); expect(settled.fundingPnl).toBe('-10'); expect(settled.netPnl).toBe(pending.netPnl);
  });
  it('withholds unclassified positive cash so a delayed deposit cannot conceal a trading loss', async () => {
    const f = await fixture(); await enter(f); f.broker.now += 1000; f.broker.price = '90'; f.broker.deposit('30');
    const complete = f.broker.getIncome.bind(f.broker);
    f.broker.getIncome = async query => (await complete(query)).filter(x => x.incomeType !== 'TRANSFER');
    const pending = await advanceLivePortfolio(f.options);
    expect(pending.currentDay.riskLatched).toBe(true); expect(pending.positions).toEqual({});
    expect(pending.equityQuality).toBe('conservative_pending_income'); expect(pending.unreconciledWalletDelta).toBe('30');
    expect(d(pending.netPnl).lt('-5.9')).toBe(true); expect(pending.netCashflow).toBe('0');
    f.broker.getIncome = complete; const settled = await advanceLivePortfolio(f.options);
    expect(settled.netCashflow).toBe('30'); expect(settled.netPnl).toBe(pending.netPnl);
  });
  it('keeps risk reductions available when history endpoints fail and records no invented fill', async () => {
    const f = await fixture(); const entered = await enter(f), count = entered.trades.length;
    f.broker.now += 1000; f.broker.price = '90';
    const complete = f.broker.getIncome.bind(f.broker);
    f.broker.getIncome = async () => { throw new Error('Income endpoint unavailable'); };
    const pending = await advanceLivePortfolio(f.options);
    expect(pending.currentDay.riskLatched).toBe(true); expect(pending.trades).toHaveLength(count);
    expect(pending.actualPositions.every(position => d(String(position.positionAmt)).isZero())).toBe(true);
    expect(pending.equityQuality).toBe('conservative_pending_income');
    expect(pending.intents.filter(intent => intent.reduceOnly)).toHaveLength(5);
    f.broker.getIncome = complete; const recovered = await advanceLivePortfolio(f.options);
    expect(recovered.positions).toEqual({}); expect(recovered.equityQuality).toBe('reconciled');
    expect(recovered.trades.length).toBeGreaterThan(count);
  });
  it('allows asynchronous UTC source within60s without extending the deadline or repeating a row', async () => {
    const f = await fixture(); await advanceLivePortfolio(f.options); f.broker.now = Date.parse('2026-10-17T00:00:01Z');
    const waiting = await advanceLivePortfolio({ ...f.options, sourcePending: true });
    expect(waiting.sourceCursorMs).toBe(Date.parse('2026-10-16T00:00:00Z')); expect(f.broker.submits).toHaveLength(0);
    const start = Date.parse('2026-10-17T00:00:00Z');
    const entered = await advanceLivePortfolio({ ...f.options, sourcePending: true, targets: targets(start) });
    expect(entered.sourceCursorMs).toBe(start); const count = f.broker.submits.length; expect(count).toBeGreaterThan(0);
    await advanceLivePortfolio({ ...f.options, targets: targets(start) }); expect(f.broker.submits).toHaveLength(count);
    const g = await fixture(); await advanceLivePortfolio(g.options); g.broker.now = start + 60_001;
    const expired = await advanceLivePortfolio({ ...g.options, sourcePending: true }); expect(expired.sourceCursorMs).toBe(start);
    expect(g.broker.submits).toHaveLength(0);
  });
  it('retains the new UTC opportunity when an authenticated tick crosses its source epoch', async () => {
    const f = await fixture(); await advanceLivePortfolio(f.options);
    const start = Date.parse('2026-10-17T00:00:00Z'), previous = start - 86_400_000;
    f.broker.now = start - 1_000;
    const account = f.broker.getAccount.bind(f.broker);
    f.broker.getAccount = async () => { f.broker.now = start + 250; return account(); };
    const waiting = await advanceLivePortfolio({ ...f.options, sourceEvaluationUtcMs: previous, sourcePending: false });
    expect(waiting.lastObservedAtMs).toBe(start + 250);
    expect(waiting.sourceCursorMs).toBe(previous); expect(f.broker.submits).toHaveLength(0);
    f.broker.getAccount = account;
    const entered = await advanceLivePortfolio({ ...f.options, sourceEvaluationUtcMs: start, targets: targets(start) });
    expect(entered.sourceCursorMs).toBe(start); const count = f.broker.submits.length; expect(count).toBeGreaterThan(0);
    await advanceLivePortfolio({ ...f.options, sourceEvaluationUtcMs: start, targets: targets(start) });
    expect(f.broker.submits).toHaveLength(count);
  });
  it('does not extend the first-minute deadline for an older evaluated source epoch', async () => {
    const f = await fixture(); await advanceLivePortfolio(f.options);
    const start = Date.parse('2026-10-17T00:00:00Z'); f.broker.now = start + 60_001;
    const expired = await advanceLivePortfolio({ ...f.options, sourceEvaluationUtcMs: start - 86_400_000 });
    expect(expired.sourceCursorMs).toBe(start); expect(f.broker.submits).toHaveLength(0);
  });
  it.each(['unavailable', 'publication_lag'] as const)('recovers an unseen income after more than24h of %s without advancing ledger coverage', async mode => {
    const f = await fixture(); const initial = await advanceLivePortfolio(f.options);
    const coverage = initial.historyThroughMs!;
    f.broker.now += 1000;
    const incomeTime = f.broker.now;
    f.broker.wallet = f.broker.wallet.plus(1);
    f.broker.income.push({ incomeType: 'FUNDING_FEE', symbol: 'BTCUSDT', asset: 'USDT',
      income: '1', tranId: 'late-funding', time: incomeTime });
    const complete = f.broker.getIncome.bind(f.broker);
    f.broker.getIncome = async () => {
      if (mode === 'unavailable') throw new Error('Temporary history outage');
      return [];
    };
    const first = await advanceLivePortfolio(f.options);
    expect(first.unreconciledWalletDelta).toBe('1'); expect(first.historyThroughMs).toBe(coverage);
    f.broker.now += 25 * 3_600_000;
    const stillWaiting = await advanceLivePortfolio(f.options);
    expect(stillWaiting.lastObservedAtMs).toBe(f.broker.now);
    expect(stillWaiting.historyThroughMs).toBe(coverage);
    f.broker.getIncome = complete; f.broker.now += 2000;
    const requests: any[] = [];
    f.broker.getIncome = async query => { requests.push(query); return complete(query); };
    const restarted = new Proxy(f.broker, { get(target, key) {
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } }) as unknown as LiveBroker;
    const recovered = await advanceLivePortfolio({ ...f.options, broker: restarted });
    expect(requests.some(query => query.startTime <= incomeTime && query.endTime >= incomeTime)).toBe(true);
    expect(recovered.unreconciledWalletDelta).toBe('0'); expect(recovered.equityQuality).toBe('reconciled');
    expect(recovered.fundingPnl).toBe('1'); expect(recovered.historyThroughMs).toBe(f.broker.now);
    expect(recovered.incomes.filter(row => row.tranId === 'late-funding')).toHaveLength(1);
    expect(f.broker.submits).toHaveLength(0);
  });
  it('checks original venue quote timestamps after order identity and position queries', async () => {
    const f = await fixture(); await advanceLivePortfolio(f.options);
    f.broker.now = Date.parse('2026-10-17T00:00:00Z');
    f.broker.getMarkPrices = async () => LIVE_SYMBOLS.map(symbol => ({ symbol, markPrice: '100', time: f.broker.now - 4500 }));
    const query = f.broker.queryOrder.bind(f.broker);
    f.broker.queryOrder = async (symbol, id) => { try { return await query(symbol, id); } finally { f.broker.now += 1000; } };
    const result = await advanceLivePortfolio({ ...f.options, targets: targets(f.broker.now) });
    expect(f.broker.submits).toHaveLength(0);
    expect(result.intents[0].status).toBe('REJECTED');
    expect(result.blockedReason).toContain('quotes aged');
  });
  it('does not POST when durable SUBMITTING publication exhausts quote validity', async () => {
    const f = await fixture(); await advanceLivePortfolio(f.options);
    f.broker.now = Date.parse('2026-10-17T00:00:00Z');
    const rename = fs.rename.bind(fs); let delayed = false;
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      const body = await fs.readFile(from, 'utf8');
      await rename(from, to);
      if (!delayed && body.includes('"status": "SUBMITTING"')) { delayed = true; f.broker.now += 6000; }
    });
    const result = await advanceLivePortfolio({ ...f.options, targets: targets(f.broker.now) });
    expect(delayed).toBe(true); expect(f.broker.submits).toHaveLength(0);
    expect(result.intents[0].status).toBe('REJECTED');
    expect(result.blockedReason).toContain('durable submission write');
  });
  it('re-reserves adverse mark/reference basis after the multi-leg projection', async () => {
    const f = await fixture(); await advanceLivePortfolio(f.options);
    f.broker.now = Date.parse('2026-10-17T00:00:00Z'); let calls = 0;
    f.broker.getTickerPrices = async () => {
      calls++;
      return LIVE_SYMBOLS.map(symbol => ({ symbol, price: calls === 1 ? '100' : '150', time: f.broker.now }));
    };
    const result = await advanceLivePortfolio({ ...f.options, targets: targets(f.broker.now) });
    expect(f.broker.submits).toHaveLength(0);
    expect(result.sourceDisposition).toBe('actual_fill_reservation_rejected');
  });
  it('recognizes owned ACK inventory during a monitoring gap before userTrades is published', async () => {
    const f = await fixture(); await enter(f); const stored = await readLiveWallet<any>(f.directory);
    stored.positions = {}; stored.trades = []; stored.processedTradeIds = [];
    stored.intents.forEach((intent: any) => { intent.observedFillQty = '0'; });
    await writeLiveWallet(f.directory, stored);
    f.broker.getUserTrades = async () => [];
    f.broker.now += 30_000;
    const result = await advanceLivePortfolio(f.options);
    expect(result.currentDay.riskLatched).toBe(true);
    expect(result.currentDay.latchReason).toBe('live_monitoring_gap');
    expect(result.actualPositions.every(p => d(String(p.positionAmt)).isZero())).toBe(true);
  });
  it('keeps authenticated account/positions fresh within a bounded REST weight budget', async () => {
    const f = await fixture();
    const weights = { getAccount: 5, getPositions: 5, getMarkPrices: 10, getTickerPrices: 2,
      getPositionMode: 30, getOpenOrders: 40, getOpenAlgoOrders: 40, getCommissionRate: 20,
      getSymbolConfiguration: 5, getExchangeInfo: 1, getIncome: 30, getUserTrades: 5 } as const;
    const spies = Object.fromEntries(Object.keys(weights).map(name => [name, vi.spyOn(f.broker, name as keyof typeof weights)]));
    await advanceLivePortfolio(f.options);
    for (let tick = 0; tick < 8; tick++) { f.broker.now += 7000; await advanceLivePortfolio(f.options); }
    const weight = Object.entries(weights).reduce((total, [name, cost]) => total + spies[name].mock.calls.length * cost, 0);
    expect(weight).toBeLessThan(800);
    expect(spies.getPositions.mock.calls.length).toBeGreaterThanOrEqual(9);
    expect(spies.getAccount.mock.calls.length).toBeGreaterThanOrEqual(9);
    expect(spies.getPositionMode).toHaveBeenCalledTimes(1);
  });
});

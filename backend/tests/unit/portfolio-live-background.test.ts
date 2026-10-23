import { describe, expect, it, vi } from 'vitest';
import type { LiveBroker } from '../../src/portfolio/live-broker';
import type { LiveIntent } from '../../src/portfolio/live-service';
import { LiveBackgroundSupport, type LiveBackgroundUpdate } from '../../src/portfolio/live-background';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
const DAY = 86_400_000;
const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  let time = Date.parse('2026-10-18T01:00:00Z');
  const broker = {
    identity: 'background-test-account',
    getExchangeInfo: vi.fn(async () => ({ symbols: [] })),
    getCommissionRate: vi.fn(async (symbol: string) => ({ symbol, takerCommissionRate: '.0005' })),
    getSymbolConfiguration: vi.fn(async () => []),
    getPositionMode: vi.fn(async () => ({ dualSidePosition: false })),
    getOpenOrders: vi.fn(async () => [] as any[]),
    getOpenAlgoOrders: vi.fn(async () => [] as any[]),
    getIncome: vi.fn(async (_query: any) => [] as any[]),
    getUserTrades: vi.fn(async (_query: any) => [] as any[]),
    queryOrder: vi.fn(async (symbol: string, clientOrderId: string) => ({ symbol, clientOrderId, status: 'FILLED', executedQty: '1' })),
    submitMarketOrder: vi.fn(), cancelOrder: vi.fn(), cancelAllOpenOrders: vi.fn(), setLeverage: vi.fn(),
  };
  const input: LiveBackgroundUpdate = { startedAtMs: time - 1000, lastObservedAtMs: time,
    accountIdentity: broker.identity, intents: [] };
  const support = new LiveBackgroundSupport(broker as unknown as LiveBroker, () => time);
  return { broker, input, support, now: () => time, advance: (delta: number) => { time += delta; } };
}
const intent = (overrides: Partial<LiveIntent> = {}): LiveIntent => ({ symbol: 'BTCUSDT', clientOrderId: 'cd15_owned',
  sourceId: 'source', quantity: '1', reduceOnly: false, createdAtMs: 1, submittedOnce: true, status: 'UNKNOWN',
  orderId: null, executedQty: '0', observedFillQty: '0', lastError: null, ...overrides });

describe('independent authenticated background observation lanes', () => {
  it('returns immediately and keeps other lanes advancing while history takes over20seconds', async () => {
    const f = fixture(), history = deferred<any[]>(); f.broker.getIncome.mockImplementation(() => history.promise);
    expect(f.support.update(f.input)).toBeUndefined(); await flush();
    expect(f.support.snapshot().pending.history).toBe(true);
    expect(f.support.snapshot().metadata).not.toBeNull(); expect(f.support.snapshot().orders).not.toBeNull();
    const firstAt = f.support.snapshot().metadata!.at;
    for (let tick = 0; tick < 32; tick++) {
      f.advance(2000); f.support.update({ ...f.input, lastObservedAtMs: f.now() }); await flush();
    }
    const state = f.support.snapshot(); expect(state.history).toBeNull(); expect(state.pending.history).toBe(true);
    expect(state.metadata!.at).toBe(firstAt + 60_000); expect(state.orders!.at).toBe(firstAt + 60_000);
    expect(f.broker.getIncome).toHaveBeenCalledTimes(1); expect(f.broker.getUserTrades).toHaveBeenCalledTimes(5);
    history.resolve([]); await flush(); expect(f.support.snapshot().pending.history).toBe(false);
    expect(f.support.snapshot().history!.through).toBe(firstAt);
  });

  it('fetches all five trade histories concurrently even when the first symbol stalls', async () => {
    const f = fixture(), first = deferred<any[]>();
    f.broker.getUserTrades.mockImplementation(query => query.symbol === 'BTCUSDT' ? first.promise : Promise.resolve([]));
    f.support.update(f.input); await flush();
    expect(f.broker.getUserTrades.mock.calls.map(([query]) => query.symbol)).toEqual(SYMBOLS);
    expect(f.support.snapshot().pending.history).toBe(true); expect(f.support.snapshot().orders).not.toBeNull();
    first.resolve([]); await flush(); expect(f.support.snapshot().history!.trades).toEqual([]);
    expect(f.broker.submitMarketOrder).not.toHaveBeenCalled();
  });

  it('keeps a failed lane in flight until its pending sibling finishes', async () => {
    const f = fixture(), sibling = deferred<any[]>(); f.broker.getIncome.mockRejectedValue(new Error('failed'));
    f.broker.getUserTrades.mockImplementation(query => query.symbol === 'BTCUSDT' ? sibling.promise : Promise.resolve([]));
    f.support.update({ ...f.input, urgentHistory: true }); await flush();
    expect(f.support.snapshot().pending.history).toBe(true);
    f.advance(20_000); f.support.update({ ...f.input, urgentHistory: true }); await flush();
    expect(f.broker.getIncome).toHaveBeenCalledTimes(1); expect(f.broker.getUserTrades).toHaveBeenCalledTimes(5);
    sibling.resolve([]); await flush(); expect(f.support.snapshot().pending.history).toBe(false);
    expect(f.support.snapshot().errors.history).toBeTruthy(); expect(f.support.snapshot().history).toBeNull();
  });

  it('budgets failed urgent history attempts at10seconds and redacts arbitrary transport errors', async () => {
    const f = fixture(); f.broker.getIncome.mockRejectedValue(new Error('https://private/?signature=SECRET botToken=TOKEN'));
    f.support.update({ ...f.input, urgentHistory: true }); await flush();
    expect(f.support.snapshot().errors.history).toBe('Authenticated background history unavailable');
    f.advance(9999); f.support.update({ ...f.input, urgentHistory: true }); await flush();
    expect(f.broker.getIncome).toHaveBeenCalledTimes(1);
    f.advance(1); f.support.update({ ...f.input, urgentHistory: true }); await flush();
    expect(f.broker.getIncome).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(f.support.snapshot())).not.toMatch(/SECRET|TOKEN|signature|https:/);
  });

  it('retains unseen fills and funding after25hours of fast observations without successful history', async () => {
    const f = fixture(); f.support.update(f.input); await flush();
    const appliedThrough = f.support.snapshot().history!.through;
    f.advance(30_000); f.broker.getIncome.mockRejectedValueOnce(new Error('history temporarily unavailable'));
    f.support.update({ ...f.input, lastObservedAtMs: f.now(), historyThroughMs: appliedThrough }); await flush();
    const eventTime = appliedThrough + 45_000;
    const funding = { time: eventTime, tranId: 'old-unseen-funding', income: '-.1' };
    const fill = { symbol: 'ETHUSDT', time: eventTime, id: 'old-unseen-fill' };
    f.broker.getIncome.mockImplementation(async query => eventTime >= query.startTime && eventTime <= query.endTime ? [funding] : []);
    f.broker.getUserTrades.mockImplementation(async query => query.symbol === fill.symbol
      && eventTime >= query.startTime && eventTime <= query.endTime ? [fill] : []);
    f.advance(25 * 3_600_000);
    f.support.update({ ...f.input, lastObservedAtMs: f.now(), historyThroughMs: appliedThrough, urgentHistory: true }); await flush();
    const history = f.support.snapshot().history!;
    expect(history.from).toBe(f.input.startedAtMs); expect(history.through).toBe(f.now());
    expect(history.incomes).toEqual([funding]); expect(history.trades).toEqual([fill]);
    expect(history.from).toBeLessThan(f.now() - DAY);
  });

  it('uses durable applied coverage after restart even when its first catch-up request fails', async () => {
    const f = fixture(), appliedThrough = f.now(), eventTime = f.now() + 60_000;
    f.advance(25 * 3_600_000);
    const restarted = new LiveBackgroundSupport(f.broker as unknown as LiveBroker, f.now);
    f.broker.getIncome.mockRejectedValueOnce(new Error('first restart request failed'));
    const input = { ...f.input, lastObservedAtMs: f.now(), historyThroughMs: appliedThrough, urgentHistory: true };
    restarted.update(input); await flush(); expect(restarted.snapshot().history).toBeNull();
    f.broker.getIncome.mockImplementation(async query => eventTime >= query.startTime && eventTime <= query.endTime
      ? [{ time: eventTime, tranId: 'missed-during-outage' }] : []);
    f.advance(10_000); restarted.update({ ...input, lastObservedAtMs: f.now() }); await flush();
    expect(restarted.snapshot().history!.from).toBe(f.input.startedAtMs);
    expect(restarted.snapshot().history!.incomes).toHaveLength(1);
    expect(f.broker.getIncome.mock.calls.every(([query]) => query.startTime === f.input.startedAtMs)).toBe(true);
  });

  it('does not advance coverage from a fetched batch until the wallet reports it applied', async () => {
    const f = fixture(); f.input.startedAtMs = f.now() - 3 * DAY;
    const appliedThrough = f.now() - DAY;
    f.support.update({ ...f.input, historyThroughMs: appliedThrough }); await flush();
    const fetchedThrough = f.support.snapshot().history!.through;
    f.advance(30_000); f.support.update({ ...f.input, lastObservedAtMs: f.now(), historyThroughMs: appliedThrough }); await flush();
    expect(f.support.snapshot().history!.from).toBe(appliedThrough - DAY);
    f.advance(30_000); f.support.update({ ...f.input, lastObservedAtMs: f.now(), historyThroughMs: fetchedThrough }); await flush();
    expect(f.support.snapshot().history!.from).toBe(fetchedThrough - DAY);
  });

  it('uses30second ordinary history and orders,60second metadata cadences', async () => {
    const f = fixture(); f.support.update(f.input); await flush();
    f.advance(29_999); f.support.update(f.input); await flush();
    expect(f.broker.getIncome).toHaveBeenCalledTimes(1); expect(f.broker.getOpenOrders).toHaveBeenCalledTimes(1);
    f.advance(1); f.support.update(f.input); await flush();
    expect(f.broker.getIncome).toHaveBeenCalledTimes(2); expect(f.broker.getOpenOrders).toHaveBeenCalledTimes(2);
    expect(f.broker.getExchangeInfo).toHaveBeenCalledTimes(1);
    f.advance(30_000); f.support.update(f.input); await flush();
    expect(f.broker.getExchangeInfo).toHaveBeenCalledTimes(2);
  });

  it('retries missing metadata/orders every10seconds then restores their normal cached cadences', async () => {
    const f = fixture(); f.broker.getExchangeInfo.mockRejectedValueOnce(new Error('cold metadata failed'));
    f.broker.getOpenOrders.mockRejectedValueOnce(new Error('cold orders failed'));
    f.support.update(f.input); await flush();
    expect(f.support.snapshot().metadata).toBeNull(); expect(f.support.snapshot().orders).toBeNull();
    f.advance(9999); f.support.update(f.input); await flush();
    expect(f.broker.getExchangeInfo).toHaveBeenCalledTimes(1); expect(f.broker.getOpenOrders).toHaveBeenCalledTimes(1);
    f.advance(1); f.support.update(f.input); await flush();
    expect(f.support.snapshot().metadata).not.toBeNull(); expect(f.support.snapshot().orders).not.toBeNull();
    expect(f.support.snapshot().errors.metadata).toBeUndefined(); expect(f.support.snapshot().errors.orders).toBeUndefined();
    f.advance(2000); f.support.update(f.input); await flush();
    expect(f.broker.getExchangeInfo).toHaveBeenCalledTimes(2); expect(f.broker.getOpenOrders).toHaveBeenCalledTimes(2);
    f.advance(28_000); f.support.update(f.input); await flush();
    expect(f.broker.getExchangeInfo).toHaveBeenCalledTimes(2); expect(f.broker.getOpenOrders).toHaveBeenCalledTimes(3);
    f.advance(30_000); f.support.update(f.input); await flush();
    expect(f.broker.getExchangeInfo).toHaveBeenCalledTimes(3);
  });

  it('retries failed cached metadata/orders after10seconds then restores healthy cadences', async () => {
    const f = fixture(); f.support.update(f.input); await flush();
    const initialAt = f.now(); f.advance(60_000);
    f.broker.getExchangeInfo.mockRejectedValueOnce(new Error('cached metadata refresh failed'));
    f.broker.getOpenOrders.mockRejectedValueOnce(new Error('cached order refresh failed'));
    f.support.update(f.input); await flush();
    expect(f.support.snapshot().metadata!.at).toBe(initialAt); expect(f.support.snapshot().orders!.at).toBe(initialAt);
    expect(f.support.snapshot().errors.metadata).toBeTruthy(); expect(f.support.snapshot().errors.orders).toBeTruthy();
    f.advance(9999); f.support.update(f.input); await flush();
    expect(f.broker.getExchangeInfo).toHaveBeenCalledTimes(2); expect(f.broker.getOpenOrders).toHaveBeenCalledTimes(2);
    f.advance(1); f.support.update(f.input); await flush();
    expect(f.support.snapshot().metadata!.at).toBe(initialAt + 70_000);
    expect(f.support.snapshot().orders!.at).toBe(initialAt + 70_000);
    expect(f.support.snapshot().errors.metadata).toBeUndefined(); expect(f.support.snapshot().errors.orders).toBeUndefined();
    f.advance(10_000); f.support.update(f.input); await flush();
    expect(f.broker.getExchangeInfo).toHaveBeenCalledTimes(3); expect(f.broker.getOpenOrders).toHaveBeenCalledTimes(3);
    f.advance(20_000); f.support.update(f.input); await flush();
    expect(f.broker.getExchangeInfo).toHaveBeenCalledTimes(3); expect(f.broker.getOpenOrders).toHaveBeenCalledTimes(4);
    f.advance(30_000); f.support.update(f.input); await flush();
    expect(f.broker.getExchangeInfo).toHaveBeenCalledTimes(4);
  });

  it('does not overlap cold metadata/orders retries while their siblings remain pending', async () => {
    const f = fixture(), fee = deferred<any>(), algo = deferred<any[]>();
    f.broker.getExchangeInfo.mockRejectedValue(new Error('failed metadata'));
    f.broker.getCommissionRate.mockImplementation(symbol => symbol === 'BTCUSDT' ? fee.promise : Promise.resolve({ symbol, takerCommissionRate: '.0005' }));
    f.broker.getOpenOrders.mockRejectedValue(new Error('failed orders')); f.broker.getOpenAlgoOrders.mockImplementation(() => algo.promise);
    f.support.update(f.input); await flush(); f.advance(10_000); f.support.update(f.input); await flush();
    expect(f.support.snapshot().pending.metadata).toBe(true); expect(f.support.snapshot().pending.orders).toBe(true);
    expect(f.broker.getExchangeInfo).toHaveBeenCalledTimes(1); expect(f.broker.getOpenOrders).toHaveBeenCalledTimes(1);
    fee.resolve({ symbol: 'BTCUSDT', takerCommissionRate: '.0005' }); algo.resolve([]); await flush();
    expect(f.support.snapshot().pending.metadata).toBe(false); expect(f.support.snapshot().pending.orders).toBe(false);
    f.support.update(f.input); await flush();
    expect(f.broker.getExchangeInfo).toHaveBeenCalledTimes(2); expect(f.broker.getOpenOrders).toHaveBeenCalledTimes(2);
  });

  it('queues a forced generation behind an inflight request and forces each lane only once', async () => {
    const f = fixture(), history = deferred<any[]>(); f.broker.getIncome.mockImplementationOnce(() => history.promise);
    const before = f.now(); f.support.update(f.input); await flush();
    f.advance(2000); const forceSinceMs = f.now(); f.support.update({ ...f.input, forceSinceMs }); await flush();
    expect(f.support.snapshot().metadata!.at).toBe(forceSinceMs); expect(f.support.snapshot().orders!.at).toBe(forceSinceMs);
    history.resolve([]); await flush(); expect(f.support.snapshot().history!.through).toBe(before);
    f.support.update({ ...f.input, forceSinceMs }); await flush();
    expect(f.support.snapshot().history!.through).toBe(forceSinceMs); expect(f.broker.getIncome).toHaveBeenCalledTimes(2);
    f.support.update({ ...f.input, forceSinceMs }); await flush();
    expect(f.broker.getIncome).toHaveBeenCalledTimes(2); expect(f.broker.getExchangeInfo).toHaveBeenCalledTimes(2);
  });

  it('captures intent identity and history bounds at update without retaining mutable wallet references', async () => {
    const f = fixture(), original = intent(); f.input.intents.push(original);
    const at = f.now(), start = f.input.startedAtMs; f.support.update(f.input);
    original.clientOrderId = 'tampered'; original.symbol = 'ETHUSDT'; f.input.lastObservedAtMs = at + 500;
    f.advance(500); await flush(); const state = f.support.snapshot();
    expect(f.broker.queryOrder).toHaveBeenCalledWith('BTCUSDT', 'cd15_owned');
    expect(state.history!.from).toBe(start); expect(state.history!.through).toBe(at);
    expect(state.intents!.at).toBe(at); expect(state.metadata!.at).toBe(at);
    state.metadata!.info.tampered = true; state.intents!.orders[0]!.order!.status = 'MODIFIED';
    expect(f.support.snapshot().metadata!.info.tampered).toBeUndefined();
    expect(f.support.snapshot().intents!.orders[0]!.order!.status).toBe('FILLED');
  });

  it('queries only unresolved IDs at2second cadence and publishes not-found without inventing an order', async () => {
    const f = fixture(); f.input.intents = [intent(), intent({ clientOrderId: 'filled', status: 'FILLED',
      executedQty: '1.000', observedFillQty: '1' })];
    f.broker.queryOrder.mockRejectedValue(Object.assign(new Error('private response'), { binanceCode: -2013 }));
    f.support.update(f.input); await flush();
    expect(f.support.snapshot().intents!.orders).toEqual([{ symbol: 'BTCUSDT', clientOrderId: 'cd15_owned', order: null }]);
    f.advance(1999); f.support.update(f.input); await flush(); expect(f.broker.queryOrder).toHaveBeenCalledTimes(1);
    f.advance(1); f.support.update(f.input); await flush(); expect(f.broker.queryOrder).toHaveBeenCalledTimes(2);
    expect(f.broker.submitMarketOrder).not.toHaveBeenCalled(); expect(f.broker.cancelOrder).not.toHaveBeenCalled();
  });

  it('retains separate sanitized failed-intent results while observing other unresolved orders', async () => {
    const f = fixture(); f.input.intents = [intent(), intent({ symbol: 'ETHUSDT', clientOrderId: 'cd15_eth' })];
    f.broker.queryOrder.mockImplementation(async (symbol, clientOrderId) => {
      if (symbol === 'BTCUSDT') throw Object.assign(new Error('signature=PRIVATE'), { binanceCode: -1007 });
      return { symbol, clientOrderId, status: 'FILLED', executedQty: '1' };
    });
    f.support.update(f.input); await flush(); const state = f.support.snapshot();
    expect(state.intents!.orders[0]!.order).toBeNull(); expect(state.intents!.orders[0]!.error).toContain('-1007');
    expect(state.intents!.orders[1]!.order!.status).toBe('FILLED'); expect(state.errors.intents).toBeTruthy();
    expect(JSON.stringify(state)).not.toContain('PRIVATE');
  });

  it('clears obsolete query failures after history has resolved every intent', async () => {
    const f = fixture(); f.input.intents = [intent()];
    f.broker.queryOrder.mockRejectedValueOnce(new Error('transient query failure'));
    f.support.update(f.input); await flush();
    expect(f.support.snapshot().errors.intents).toBeTruthy(); expect(f.support.snapshot().intents).not.toBeNull();
    f.input.intents[0] = intent({ status: 'FILLED', executedQty: '1', observedFillQty: '1' });
    f.support.update(f.input);
    expect(f.support.snapshot().errors.intents).toBeUndefined(); expect(f.support.snapshot().intents).toBeNull();
    expect(f.broker.queryOrder).toHaveBeenCalledTimes(1);
  });

  it('waits for a pending query to settle before clearing a now-resolved intent lane', async () => {
    const f = fixture(), query = deferred<any>(); f.input.intents = [intent()];
    f.broker.queryOrder.mockImplementationOnce(() => query.promise);
    f.support.update(f.input); await flush(); expect(f.support.snapshot().pending.intents).toBe(true);
    f.input.intents[0] = intent({ status: 'FILLED', executedQty: '1', observedFillQty: '1' });
    f.support.update(f.input); expect(f.support.snapshot().pending.intents).toBe(true);
    query.resolve({ symbol: 'WRONGUSDT', clientOrderId: 'cd15_owned' }); await flush();
    expect(f.support.snapshot().errors.intents).toBeTruthy();
    f.support.update(f.input);
    expect(f.support.snapshot().errors.intents).toBeUndefined(); expect(f.support.snapshot().intents).toBeNull();
    expect(f.broker.queryOrder).toHaveBeenCalledTimes(1);
  });

  it('splits saturated trade windows and keeps all requests within seven days', async () => {
    const f = fixture(); f.input.startedAtMs = f.now() - 20 * DAY; f.input.lastObservedAtMs = f.input.startedAtMs;
    let saturated = false;
    f.broker.getUserTrades.mockImplementation(async query => {
      if (query.symbol !== 'BTCUSDT') return [];
      if (!saturated) { saturated = true; return Array.from({ length: 1000 }, () => ({ symbol: query.symbol, time: query.startTime })); }
      return [{ symbol: query.symbol, time: query.endTime }];
    });
    f.support.update(f.input); await flush(); const state = f.support.snapshot();
    expect(state.history!.trades.length).toBe(4);
    for (const [query] of f.broker.getUserTrades.mock.calls) expect(query.endTime - query.startTime).toBeLessThan(7 * DAY);
    expect(state.errors.history).toBeUndefined();
  });

  it('bootstraps missing durable coverage from wallet start and segments long income catch-up within seven days', async () => {
    const f = fixture(); f.input.startedAtMs = f.now() - 20 * DAY;
    f.support.update(f.input); await flush();
    expect(f.support.snapshot().history!.from).toBe(f.input.startedAtMs);
    expect(f.broker.getIncome).toHaveBeenCalledTimes(3);
    for (const [query] of f.broker.getIncome.mock.calls) expect(query.endTime - query.startTime).toBeLessThan(7 * DAY);
    const calls = f.broker.getIncome.mock.calls.map(([query]) => query);
    expect(calls[0].startTime).toBe(f.input.startedAtMs);
    expect(calls[1].startTime).toBe(calls[0].endTime + 1);
    expect(calls[2].startTime).toBe(calls[1].endTime + 1); expect(calls[2].endTime).toBe(f.now());
  });

  it('paginates complete income and rejects out-of-range rows without publishing partial coverage', async () => {
    const f = fixture(); f.broker.getIncome.mockImplementation(async query => query.page === 1
      ? Array.from({ length: 1000 }, (_, index) => ({ time: query.startTime, tranId: String(index) })) : [{ time: query.endTime }]);
    f.support.update(f.input); await flush(); expect(f.support.snapshot().history!.incomes).toHaveLength(1001);
    f.advance(30_000); f.broker.getIncome.mockImplementation(async query => [{ time: query.endTime + 1 }]);
    f.support.update(f.input); await flush();
    expect(f.support.snapshot().history!.revision).toBe(1); expect(f.support.snapshot().errors.history).toBeTruthy();
  });

  it('stops after100 saturated income pages and never calls an incomplete result complete', async () => {
    const f = fixture(); const full = Array.from({ length: 1000 }, () => ({ time: f.now() }));
    f.broker.getIncome.mockResolvedValue(full); f.support.update(f.input); await flush();
    expect(f.broker.getIncome).toHaveBeenCalledTimes(100); expect(f.support.snapshot().history).toBeNull();
    expect(f.support.snapshot().errors.history).toBeTruthy(); expect(f.support.snapshot().pending.history).toBe(false);
  });

  it('rejects wrong-symbol trades and saturated single-millisecond coverage', async () => {
    const f = fixture(); f.broker.getUserTrades.mockImplementation(async query => [{ symbol: 'FOREIGNUSDT', time: query.startTime }]);
    f.support.update(f.input); await flush(); expect(f.support.snapshot().history).toBeNull();
    expect(f.support.snapshot().errors.history).toBeTruthy();
    const g = fixture(); g.input.startedAtMs = g.now();
    g.broker.getUserTrades.mockImplementation(async query => query.symbol === 'BTCUSDT'
      ? Array.from({ length: 1000 }, () => ({ symbol: query.symbol, time: query.startTime })) : []);
    g.support.update(g.input); await flush(); expect(g.support.snapshot().history).toBeNull();
    expect(g.support.snapshot().errors.history).toBeTruthy(); expect(g.broker.getUserTrades).toHaveBeenCalledTimes(5);
  });

  it('rejects a changed account/wallet identity before scheduling any requests', () => {
    const f = fixture(); expect(() => f.support.update({ ...f.input, accountIdentity: 'foreign-account' })).toThrow('identity');
    expect(f.broker.getExchangeInfo).not.toHaveBeenCalled(); f.support.update(f.input);
    expect(() => f.support.update({ ...f.input, startedAtMs: f.input.startedAtMs - 1 })).toThrow('wallet identity');
  });

  it('rejects invalid durable history coverage before scheduling any requests', () => {
    for (const historyThroughMs of [NaN, Infinity, -1]) {
      const f = fixture(); expect(() => f.support.update({ ...f.input, historyThroughMs })).toThrow('timestamp');
      expect(f.broker.getIncome).not.toHaveBeenCalled();
    }
    const f = fixture();
    expect(() => f.support.update({ ...f.input, historyThroughMs: f.input.startedAtMs - 1 })).toThrow('coverage');
    expect(() => f.support.update({ ...f.input, historyThroughMs: f.now() + 1 })).toThrow('coverage');
    expect(f.broker.getIncome).not.toHaveBeenCalled();
  });
});

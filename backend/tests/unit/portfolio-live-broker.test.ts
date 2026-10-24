import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const axios = vi.hoisted(() => vi.fn());
vi.mock('axios', () => ({ default: axios }));
import { BinanceLiveBroker, createDefaultLiveBroker, LiveBrokerError, parseLiveBinanceJson } from '../../src/portfolio/live-broker';
import type { LiveBrokerTransport, LiveMarketOrderRequest } from '../../src/portfolio/live-broker';

const intent: LiveMarketOrderRequest = { symbol: 'BTCUSDT', side: 'BUY', quantity: '0.001',
  clientOrderId: 'cdb5-20261016-1', positionSide: 'BOTH' };
const partial = { symbol: 'BTCUSDT', clientOrderId: intent.clientOrderId, orderId: '9007199254740993',
  status: 'PARTIALLY_FILLED', executedQty: '0.00040000', origQty: '0.00100000', avgPrice: '61000.12345678',
  cumQuote: '24.400049382712', commission: '0.0048800098765424', commissionAsset: 'USDT' };
beforeEach(() => {
  vi.stubEnv('BINANCE_BASE_URL', 'https://demo-fapi.binance.com');
  vi.stubEnv('PORTFOLIO_EXECUTION_OWNER', '');
  axios.mockReset();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('live broker raw venue transport', () => {
  it('preserves distinct int64 IDs and does not rewrite quoted or escaped JSON text', () => {
    const value = parseLiveBinanceJson('[{"id":9007199254740992,"orderId":9007199254740993,"tranId":18446744073709551615,"price":"100.00000001","time":1780851600000,"msg":"escaped \\\"orderId\\\":9007199254740993","nested":{"id":42}}]') as any[];
    expect(value[0]).toEqual({ id: '9007199254740992', orderId: '9007199254740993', tranId: '18446744073709551615',
      price: '100.00000001', time: 1780851600000, msg: 'escaped "orderId":9007199254740993', nested: { id: 42 } });
    expect(parseLiveBinanceJson('{"x":-9007199254740993,"y":1.25e-3,"flag":false}')).toEqual({ x: '-9007199254740993', y: .00125, flag: false });
    expect(() => parseLiveBinanceJson('{"id":9007199254740993,}')).toThrow();
  });

  it('returns actual partial fill decimal strings without synthetic fills or fees', async () => {
    const transport = vi.fn<LiveBrokerTransport>().mockResolvedValue(partial);
    const broker = new BinanceLiveBroker(transport);
    expect(await broker.submitMarketOrder(intent)).toEqual(partial);
    expect(transport).toHaveBeenCalledExactlyOnceWith('POST', '/fapi/v1/order', {
      symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: '0.001', newClientOrderId: intent.clientOrderId,
      positionSide: 'BOTH', newOrderRespType: 'RESULT',
    }, true);
  });

  it('surfaces ambiguous POST once, queries the exact persisted client identity, and never retries the POST', async () => {
    const transport = vi.fn<LiveBrokerTransport>().mockRejectedValueOnce(new Error('timeout https://secret.example/?signature=LEAK apiKey=LEAK'))
      .mockResolvedValueOnce(partial);
    const broker = new BinanceLiveBroker(transport);
    const failure = await broker.submitMarketOrder(intent).catch(error => error);
    expect(failure).toBeInstanceOf(LiveBrokerError); expect(failure.ambiguous).toBe(true);
    expect(String(failure)).not.toMatch(/secret|LEAK|signature|apiKey/); expect(failure.cause).toBeUndefined();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await broker.queryOrder('BTCUSDT', intent.clientOrderId)).toEqual(partial);
    expect(transport.mock.calls[1]).toEqual(['GET', '/fapi/v1/order', { symbol: 'BTCUSDT', origClientOrderId: intent.clientOrderId }, true]);
  });

  it('preserves venue not-found code and distinguishes deterministic rejects from unknown execution', async () => {
    const transport = vi.fn<LiveBrokerTransport>().mockRejectedValueOnce({ binanceCode: -2013, message: 'URL SECRET' })
      .mockRejectedValueOnce({ response: { data: { code: -2022, msg: 'SECRET' } } })
      .mockResolvedValueOnce({ code: -1007, msg: 'SECRET' });
    const broker = new BinanceLiveBroker(transport);
    await expect(broker.queryOrder('BTCUSDT', intent.clientOrderId)).rejects.toMatchObject({ binanceCode: -2013, ambiguous: false });
    await expect(broker.submitMarketOrder({ ...intent, reduceOnly: true })).rejects.toMatchObject({ binanceCode: -2022, ambiguous: false });
    await expect(broker.submitMarketOrder(intent)).rejects.toMatchObject({ binanceCode: -1007, ambiguous: true });
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it('rejects wrong order identity and rounded numeric order IDs rather than inventing exact IDs', async () => {
    const transport = vi.fn<LiveBrokerTransport>().mockResolvedValueOnce({ ...partial, clientOrderId: 'some-other-order' })
      .mockResolvedValueOnce({ ...partial, orderId: 9007199254740992 });
    const broker = new BinanceLiveBroker(transport);
    await expect(broker.queryOrder('BTCUSDT', intent.clientOrderId)).rejects.toMatchObject({ reason: 'invalid_response', ambiguous: false });
    await expect(broker.submitMarketOrder(intent)).rejects.toMatchObject({ reason: 'invalid_response', ambiguous: true });
  });

  it('only sends reduceOnly for BOTH mode and rejects malformed quantities before transport', async () => {
    const transport = vi.fn<LiveBrokerTransport>().mockResolvedValue(partial);
    const broker = new BinanceLiveBroker(transport);
    await expect(broker.submitMarketOrder({ ...intent, positionSide: 'LONG', reduceOnly: true })).rejects.toThrow('hedge mode');
    await expect(broker.submitMarketOrder({ ...intent, positionSide: 'SHORT', reduceOnly: false })).rejects.toThrow('hedge mode');
    for (const quantity of ['0', '-.001', '1e-3', 'NaN', '0.0000']) {
      await expect(broker.submitMarketOrder({ ...intent, quantity })).rejects.toThrow('quantity');
    }
    expect(transport).not.toHaveBeenCalled();
    await broker.submitMarketOrder({ ...intent, side: 'SELL', reduceOnly: true });
    expect(transport.mock.calls[0][2]).toMatchObject({ side: 'SELL', reduceOnly: 'true' });
  });

  it('submits valid stop market and limit orders with proper parameter transformation', async () => {
    const transport = vi.fn<LiveBrokerTransport>()
      .mockResolvedValueOnce({ ...partial, clientOrderId: 'sl-btc-1' })
      .mockResolvedValueOnce({ ...partial, clientOrderId: 'grid-btc-1' });
    const broker = new BinanceLiveBroker(transport);

    // Stop Market
    await broker.submitStopMarketOrder({
      symbol: 'BTCUSDT', side: 'SELL', quantity: '0.001', stopPrice: '59000',
      clientOrderId: 'sl-btc-1', positionSide: 'BOTH', reduceOnly: true,
    });
    expect(transport.mock.calls[0]).toEqual(['POST', '/fapi/v1/order', {
      symbol: 'BTCUSDT', side: 'SELL', type: 'STOP_MARKET', stopPrice: '59000', quantity: '0.001',
      newClientOrderId: 'sl-btc-1', positionSide: 'BOTH', newOrderRespType: 'RESULT', reduceOnly: 'true',
    }, true]);

    // Limit Order
    await broker.submitLimitOrder({
      symbol: 'BTCUSDT', side: 'BUY', price: '58000', quantity: '0.001',
      clientOrderId: 'grid-btc-1', positionSide: 'BOTH',
    });
    expect(transport.mock.calls[1]).toEqual(['POST', '/fapi/v1/order', {
      symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', price: '58000', quantity: '0.001',
      timeInForce: 'GTC', newClientOrderId: 'grid-btc-1', positionSide: 'BOTH', newOrderRespType: 'RESULT',
    }, true]);
  });

  it('keeps mainnet mutation acknowledgment enforced even for an injected transport', async () => {
    vi.stubEnv('BINANCE_BASE_URL', 'https://fapi.binance.com'); vi.stubEnv('MAINNET_LIVE_TRADING_ENABLED', 'false');
    const transport = vi.fn<LiveBrokerTransport>(); const broker = new BinanceLiveBroker(transport);
    await expect(broker.submitMarketOrder(intent)).rejects.toMatchObject({ reason: 'mutation_blocked', ambiguous: false });
    expect(transport).not.toHaveBeenCalled();
  });

  it('passes explicit identity through, leaves account setup unchanged, and preserves optional account/position data', async () => {
    const account = { canTrade: true, multiAssetsMargin: false, totalWalletBalance: '100.000000000000001',
      totalUnrealizedProfit: '-0.000000000000001', totalMarginBalance: '100.000000000000000', availableBalance: '80',
      assets: [{ asset: 'USDT', walletBalance: '100.000000000000001' }] };
    const position = { symbol: 'BTCUSDT', positionAmt: '.001', entryPrice: '60000', positionSide: 'BOTH',
      markPrice: '60001', isolatedWallet: '0', initialMargin: '6', maintMargin: '.3', leverage: '10', marginType: 'cross' };
    const transport = vi.fn<LiveBrokerTransport>().mockResolvedValueOnce(account).mockResolvedValueOnce([position])
      .mockResolvedValueOnce({ dualSidePosition: false });
    const broker = new BinanceLiveBroker(transport, 'account-fingerprint');
    expect(broker.identity).toBe('account-fingerprint'); expect(await broker.getAccount()).toEqual(account);
    expect(await broker.getPositions()).toEqual([position]); expect(await broker.getPositionMode()).toEqual({ dualSidePosition: false });
    expect(transport.mock.calls.every(call => call[0] === 'GET')).toBe(true);
  });

  it('passes explicit history cursors/ranges and preserves actual commissions, funding and int64 identities', async () => {
    const trade = { id: '9007199254740993', orderId: partial.orderId, symbol: 'BTCUSDT', price: '60000.00001',
      qty: '.001', commission: '.012345678901', commissionAsset: 'USDT', realizedPnl: '-.0000001', time: 100 };
    const funding = { tranId: '9007199254740995', symbol: 'BTCUSDT', incomeType: 'FUNDING_FEE', income: '-.000000000123', asset: 'USDT', time: 100 };
    const transport = vi.fn<LiveBrokerTransport>().mockResolvedValueOnce([trade]).mockResolvedValueOnce([funding]);
    const broker = new BinanceLiveBroker(transport);
    expect(await broker.getUserTrades({ symbol: 'BTCUSDT', fromId: '9007199254740993', limit: 1000 })).toEqual([trade]);
    expect(await broker.getIncome({ startTime: 1, endTime: 100, page: 2, limit: 1000 })).toEqual([funding]);
    expect(transport.mock.calls[0][2]).toEqual({ symbol: 'BTCUSDT', fromId: '9007199254740993', limit: 1000 });
    await expect(broker.getUserTrades({ symbol: 'BTCUSDT', fromId: 123, startTime: 1 })).rejects.toThrow('cursor');
    await expect(broker.getIncome({ page: 0 })).rejects.toThrow('page');
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('returns raw public price timestamps and raw exchange filters; never synthesizes a fresh quote', async () => {
    const marks = [{ symbol: 'BTCUSDT', markPrice: '60001.00000001', time: 100 }];
    const ticker = { symbol: 'BTCUSDT', price: '60000.00000001', time: 95 };
    const info = { symbols: [{ symbol: 'BTCUSDT', filters: [{ filterType: 'MARKET_LOT_SIZE', stepSize: '.001', minQty: '.001', maxQty: '100' }] }] };
    const transport = vi.fn<LiveBrokerTransport>().mockResolvedValueOnce(marks).mockResolvedValueOnce(ticker).mockResolvedValueOnce(info);
    const broker = new BinanceLiveBroker(transport);
    expect(await broker.getMarkPrices()).toEqual(marks); expect(await broker.getTickerPrices('BTCUSDT')).toEqual([ticker]);
    expect(await broker.getExchangeInfo()).toEqual(info); expect(transport.mock.calls.every(call => call[3] === false)).toBe(true);
  });

  it('reads actual symbol leverage/margin configuration without changing account settings', async () => {
    const setup = [{ symbol: 'BTCUSDT', marginType: 'CROSSED', leverage: 10, isAutoAddMargin: false, maxNotionalValue: '1000000' }];
    const transport = vi.fn<LiveBrokerTransport>().mockResolvedValue(setup);
    const broker = new BinanceLiveBroker(transport);
    expect(await broker.getSymbolConfiguration('BTCUSDT')).toEqual(setup);
    expect(transport).toHaveBeenCalledExactlyOnceWith('GET', '/fapi/v1/symbolConfig', { symbol: 'BTCUSDT' }, true);
  });

  it('forwards the new execution owner through default HTTP options and blocks a different owner', async () => {
    vi.stubEnv('PORTFOLIO_EXECUTION_OWNER', 'CONSTANT_DIRECTION_B5_S6_DAILY15_V1');
    axios.mockResolvedValue({ data: partial });
    expect(await createDefaultLiveBroker().submitMarketOrder(intent)).toEqual(partial);
    expect(axios).toHaveBeenCalledTimes(1);
    vi.stubEnv('PORTFOLIO_EXECUTION_OWNER', 'another-execution-owner');
    await expect(createDefaultLiveBroker().submitMarketOrder(intent)).rejects.toMatchObject({ reason: 'mutation_blocked', ambiguous: false });
    expect(axios).toHaveBeenCalledTimes(1);
  });

  it('default POST uses exactly one HTTP request and quiet failures never log URL/API credentials', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnLog = vi.spyOn(console, 'warn').mockImplementation(() => {});
    axios.mockRejectedValue({ request: {}, message: 'https://host?signature=SECRET&X-MBX-APIKEY=SECRET' });
    const broker = createDefaultLiveBroker();
    await expect(broker.submitMarketOrder(intent)).rejects.toMatchObject({ ambiguous: true });
    expect(axios).toHaveBeenCalledTimes(1); expect(errorLog).not.toHaveBeenCalled(); expect(warnLog).not.toHaveBeenCalled();
    const options = axios.mock.calls[0][0];
    expect(options.method).toBe('POST'); expect(options.transformResponse[0]('{"id":9007199254740993}')).toEqual({ id: '9007199254740993' });
  });

  it('default signed reads retry only GET, while deterministic GET errors expose only sanitized code', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnLog = vi.spyOn(console, 'warn').mockImplementation(() => {});
    axios.mockRejectedValue({ response: { data: { code: -2015, msg: 'signature=SECRET' } } });
    const broker = createDefaultLiveBroker();
    await expect(broker.queryOrder('BTCUSDT', intent.clientOrderId)).rejects.toMatchObject({ binanceCode: -2015, ambiguous: false });
    expect(axios).toHaveBeenCalledTimes(1); expect(errorLog).not.toHaveBeenCalled(); expect(warnLog).not.toHaveBeenCalled();
    expect(axios.mock.calls[0][0].method).toBe('GET');
  });
  it('honors venue ban expiry across all methods without issuing requests during cooldown', async () => {
    const start = 1792164600000, now = vi.spyOn(Date, 'now').mockReturnValue(start);
    axios.mockRejectedValueOnce({ response: { status: 418, headers: { 'retry-after': '120' },
      data: { code: -1003, msg: `IP banned until ${start + 180000}` } } });
    const broker = createDefaultLiveBroker();
    await expect(broker.getAccount()).rejects.toMatchObject({ binanceCode: -1003 });
    now.mockReturnValue(start + 121000);
    await expect(broker.submitMarketOrder(intent)).rejects.toMatchObject({ binanceCode: -1003 });
    await expect(broker.queryOrder('BTCUSDT', intent.clientOrderId)).rejects.toMatchObject({ binanceCode: -1003 });
    expect(axios).toHaveBeenCalledTimes(1);
    now.mockReturnValue(start + 182000); axios.mockResolvedValueOnce({ data: partial });
    expect(await broker.queryOrder('BTCUSDT', intent.clientOrderId)).toEqual(partial);
    expect(axios).toHaveBeenCalledTimes(2);
  });

  it('forwards the short monitoring deadline to reads and writes without automatic retries', async () => {
    axios.mockRejectedValue({ request: {}, message: 'URL?signature=SECRET' });
    const broker = createDefaultLiveBroker({ requestTimeoutMs: 3000, retryReads: false });
    await expect(broker.getAccount()).rejects.toMatchObject({ ambiguous: false });
    await expect(broker.submitMarketOrder(intent)).rejects.toMatchObject({ ambiguous: true });
    await expect(broker.cancelOrder('BTCUSDT', intent.clientOrderId)).rejects.toMatchObject({ ambiguous: true });
    expect(axios).toHaveBeenCalledTimes(3);
    expect(axios.mock.calls.map(([options]) => options.method)).toEqual(['GET', 'POST', 'DELETE']);
    for (const [options] of axios.mock.calls) {
      expect(options.timeout).toBe(3000);
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(options.signal.aborted).toBe(false);
    }
  });

  it('aborts an HTTP attempt at the full deadline, including pending connection setup', async () => {
    vi.useFakeTimers();
    axios.mockImplementation(options => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject({ request: {}, message: 'Canceled URL?signature=SECRET' }), { once: true });
    }));
    const broker = createDefaultLiveBroker({ requestTimeoutMs: 3000, retryReads: false });
    const pending = broker.getAccount().catch(error => error);
    await vi.advanceTimersByTimeAsync(2999);
    expect(axios.mock.calls[0][0].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const failure = await pending;
    expect(failure).toBeInstanceOf(LiveBrokerError);
    expect(failure.ambiguous).toBe(false);
    expect(String(failure)).not.toMatch(/SECRET|signature|Canceled/);
    expect(axios.mock.calls[0][0].signal.aborted).toBe(true);
    expect(axios).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up the explicit deadline after a successful request', async () => {
    vi.useFakeTimers();
    axios.mockResolvedValue({ data: partial });
    const broker = createDefaultLiveBroker({ requestTimeoutMs: 3000, retryReads: false });
    expect(await broker.queryOrder('BTCUSDT', intent.clientOrderId)).toEqual(partial);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(axios.mock.calls[0][0].signal.aborted).toBe(false);
  });

  it('keeps the legacy default read retry count and 30-second per-attempt timeout', async () => {
    vi.useFakeTimers();
    axios.mockRejectedValueOnce({ request: {} }).mockRejectedValueOnce({ request: {} })
      .mockResolvedValueOnce({ data: partial });
    const pending = createDefaultLiveBroker().queryOrder('BTCUSDT', intent.clientOrderId);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toEqual(partial);
    expect(axios).toHaveBeenCalledTimes(3);
    for (const [options] of axios.mock.calls) {
      expect(options.timeout).toBe(30000);
      expect(options).not.toHaveProperty('signal');
    }
  });

  it('rejects invalid deadlines or retry settings before any HTTP request', () => {
    for (const requestTimeoutMs of [0, -1, .5, NaN, Infinity, 2147483648]) {
      expect(() => createDefaultLiveBroker({ requestTimeoutMs })).toThrow('timeout');
    }
    expect(() => createDefaultLiveBroker({ retryReads: 'false' as unknown as boolean })).toThrow('retry');
    expect(axios).not.toHaveBeenCalled();
  });
});

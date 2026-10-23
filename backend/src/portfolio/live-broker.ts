import { createHash } from 'node:crypto';
import { request, requestWithRetry } from '../services/binance/client';
import { config } from '../services/binance/config';
import { assertBinanceMutationAllowed } from '../config/mainnet-safety';

/** Financial amounts stay in the decimal strings returned by the venue. */
export type LiveVenueId = number | string;
export type LiveRawRow = Record<string, unknown>;
export interface LiveAsset extends LiveRawRow { asset: string; walletBalance: string; availableBalance?: string; }
export interface LivePosition extends LiveRawRow {
  symbol: string; positionAmt: string; entryPrice: string; markPrice?: string;
  unRealizedProfit?: string; unrealizedProfit?: string; positionSide: 'BOTH' | 'LONG' | 'SHORT';
  leverage?: string; marginType?: string; isolatedWallet?: string; initialMargin?: string; maintMargin?: string;
}
export interface LiveAccount extends LiveRawRow {
  canTrade?: boolean; multiAssetsMargin?: boolean; totalWalletBalance: string;
  totalUnrealizedProfit: string; totalMarginBalance: string; availableBalance: string;
  assets: LiveAsset[]; positions?: LivePosition[];
}
export interface LiveOrder extends LiveRawRow {
  orderId: LiveVenueId; clientOrderId: string; symbol: string; status: string;
  executedQty: string; origQty?: string; avgPrice?: string; cumQuote?: string;
  side?: 'BUY' | 'SELL'; positionSide?: 'BOTH' | 'LONG' | 'SHORT'; reduceOnly?: boolean;
}
export interface LiveAlgoOrder extends LiveRawRow { algoId?: LiveVenueId; symbol?: string; }
export interface LiveUserTrade extends LiveRawRow {
  id: LiveVenueId; orderId: LiveVenueId; symbol: string; price: string; qty: string;
  commission: string; commissionAsset: string; realizedPnl: string; time: number;
}
export interface LiveIncome extends LiveRawRow {
  tranId: LiveVenueId; symbol?: string; incomeType: string; income: string; asset: string; time: number;
}
export interface LiveMarkPrice extends LiveRawRow { symbol: string; markPrice: string; time: number; }
export interface LiveTickerPrice extends LiveRawRow { symbol: string; price: string; time?: number; }
export interface LiveExchangeFilter extends LiveRawRow { filterType: string; }
export interface LiveExchangeSymbol extends LiveRawRow { symbol: string; filters: LiveExchangeFilter[]; }
export interface LiveExchangeInfo extends LiveRawRow { symbols: LiveExchangeSymbol[]; }
export interface LiveCommissionRate extends LiveRawRow {
  symbol: string; makerCommissionRate: string; takerCommissionRate: string;
}
export interface LiveSymbolConfiguration extends LiveRawRow {
  symbol: string; marginType: string; leverage: number | string;
  isAutoAddMargin?: boolean; maxNotionalValue?: string;
}
export interface LiveUserTradesQuery {
  symbol: string; startTime?: number; endTime?: number; fromId?: LiveVenueId; limit?: number;
}
export interface LiveIncomeQuery {
  symbol?: string; incomeType?: string; startTime?: number; endTime?: number; page?: number; limit?: number;
}
export interface LiveMarketOrderRequest {
  symbol: string; side: 'BUY' | 'SELL'; quantity: string; clientOrderId: string;
  positionSide: 'BOTH' | 'LONG' | 'SHORT'; reduceOnly?: boolean;
}
export type LiveBrokerTransport = (
  method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, string | number>, signed: boolean,
) => Promise<unknown>;

export interface LiveBroker {
  readonly identity: string;
  getAccount(): Promise<LiveAccount>;
  getPositions(symbol?: string): Promise<LivePosition[]>;
  getPositionMode(): Promise<{ dualSidePosition: boolean }>;
  getOpenOrders(symbol?: string): Promise<LiveOrder[]>;
  getOpenAlgoOrders(symbol?: string): Promise<LiveAlgoOrder[]>;
  getUserTrades(query: LiveUserTradesQuery): Promise<LiveUserTrade[]>;
  getIncome(query: LiveIncomeQuery): Promise<LiveIncome[]>;
  getExchangeInfo(): Promise<LiveExchangeInfo>;
  getMarkPrices(symbol?: string): Promise<LiveMarkPrice[]>;
  getTickerPrices(symbol?: string): Promise<LiveTickerPrice[]>;
  getCommissionRate(symbol: string): Promise<LiveCommissionRate>;
  getSymbolConfiguration(symbol?: string): Promise<LiveSymbolConfiguration[]>;
  getLeverageBrackets(symbol?: string): Promise<LiveRawRow[]>;
  queryOrder(symbol: string, clientOrderId: string): Promise<LiveOrder>;
  submitMarketOrder(order: LiveMarketOrderRequest): Promise<LiveOrder>;
  cancelOrder(symbol: string, clientOrderId: string): Promise<LiveOrder>;
  cancelAllOpenOrders(symbol: string): Promise<LiveRawRow>;
  setLeverage(symbol: string, leverage: number): Promise<LiveRawRow>;
}

/** No cause, response payload, API key, signature, or URL is retained in this error. */
export class LiveBrokerError extends Error {
  readonly name = 'LiveBrokerError';
  constructor(readonly method: string, readonly path: string, readonly binanceCode?: number,
    readonly ambiguous = false, readonly reason = 'request_failed') {
    super(`Binance portfolio ${method} ${path} failed (${reason}${binanceCode === undefined ? '' : `, code ${binanceCode}`}).`);
  }
}

/**
 * Lex JSON before parsing: unsafe integral number tokens become exact strings.
 * Quoted text (including escaped quotes and identifier-looking text) is never changed.
 * Ordinary numbers, decimal amounts, booleans, and already quoted IDs retain their type.
 */
export function parseLiveBinanceJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  let out = '', cursor = 0;
  while (cursor < raw.length) {
    const start = cursor;
    if (raw[cursor] === '"') {
      cursor++;
      while (cursor < raw.length) {
        if (raw[cursor] === '\\') { cursor += 2; continue; }
        if (raw[cursor++] === '"') break;
      }
      out += raw.slice(start, cursor);
    } else if (raw[cursor] === '-' || /[0-9]/.test(raw[cursor])) {
      while (cursor < raw.length && /[0-9eE.+-]/.test(raw[cursor])) cursor++;
      const token = raw.slice(start, cursor);
      if (/^-?(?:0|[1-9][0-9]*)$/.test(token)) {
        const integer = BigInt(token);
        out += integer > BigInt(Number.MAX_SAFE_INTEGER) || integer < BigInt(Number.MIN_SAFE_INTEGER)
          ? JSON.stringify(token) : token;
      } else out += token;
    } else out += raw[cursor++];
  }
  return JSON.parse(out) as unknown;
}

function symbolParams(symbol?: string): Record<string, string> {
  if (symbol === undefined) return {};
  if (!/^[A-Z0-9_]{2,40}$/.test(symbol)) throw new Error('Invalid Binance portfolio symbol.');
  return { symbol };
}
function assertClientOrderId(value: string): void {
  if (!/^[.A-Z:/a-z0-9_-]{1,36}$/.test(value)) throw new Error('Invalid Binance portfolio client order ID.');
}
function assertSafeId(value: unknown): void {
  if ((typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
    || (typeof value === 'string' && /^[0-9]+$/.test(value))) return;
  throw new Error('Invalid or unsafe Binance venue identifier.');
}
function assertResponseIds(value: unknown): void {
  if (Array.isArray(value)) { value.forEach(assertResponseIds); return; }
  if (!value || typeof value !== 'object') return;
  for (const [key, member] of Object.entries(value)) {
    if (/^(?:id|orderId|tradeId|tranId|algoId)$/.test(key) && member !== undefined && member !== null && member !== '') assertSafeId(member);
    else if (member && typeof member === 'object') assertResponseIds(member);
  }
}
function row(value: unknown): LiveRawRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Binance object response.');
  return value as LiveRawRow;
}
function rows(value: unknown): LiveRawRow[] {
  if (!Array.isArray(value)) throw new Error('Invalid Binance array response.');
  return value.map(row);
}
function strings(value: LiveRawRow, keys: string[]): void {
  for (const key of keys) if (typeof value[key] !== 'string') throw new Error('Missing Binance decimal string.');
}
function queryRange(query: { startTime?: number; endTime?: number; limit?: number }): void {
  for (const key of ['startTime', 'endTime'] as const) {
    const value = query[key];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new Error('Invalid Binance history timestamp.');
  }
  if (query.startTime !== undefined && query.endTime !== undefined && query.endTime < query.startTime) throw new Error('Invalid Binance history range.');
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 1000)) throw new Error('Invalid Binance history page size.');
}
function cleanParams(query: object): Record<string, string | number> {
  return Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined)) as Record<string, string | number>;
}

export class BinanceLiveBroker implements LiveBroker {
  constructor(private readonly transport: LiveBrokerTransport, readonly identity = 'injected-binance-transport',
    private readonly executionOwner = 'CONSTANT_DIRECTION_B5_S6_DAILY15_V1') {}

  private async call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, string | number>,
    signed: boolean, validate: (value: unknown) => T): Promise<T> {
    let value: unknown;
    try {
      // Injected transports cannot bypass the application's existing mainnet/owner gate.
      assertBinanceMutationAllowed(method, path, this.executionOwner);
    } catch {
      throw new LiveBrokerError(method, path, undefined, false, 'mutation_blocked');
    }
    try {
      value = await this.transport(method, path, params, signed);
    } catch (error: unknown) {
      const source = error as { binanceCode?: unknown; code?: unknown; response?: { status?: unknown; data?: { code?: unknown } } };
      const candidate = source?.binanceCode ?? source?.response?.data?.code ?? source?.code;
      const code = typeof candidate === 'number' && Number.isSafeInteger(candidate) ? candidate : undefined;
      const ambiguous = method !== 'GET' && (code === undefined || [-1000, -1001, -1006, -1007].includes(code));
      throw new LiveBrokerError(method, path, code, ambiguous);
    }
    try {
      const record = value && !Array.isArray(value) && typeof value === 'object' ? value as LiveRawRow : undefined;
      if (record && typeof record.code === 'number' && record.code < 0) {
        throw new LiveBrokerError(method, path, record.code,
          method !== 'GET' && [-1000, -1001, -1006, -1007].includes(record.code));
      }
      assertResponseIds(value);
      return validate(value);
    } catch (error) {
      if (error instanceof LiveBrokerError) throw error;
      throw new LiveBrokerError(method, path, undefined, method !== 'GET', 'invalid_response');
    }
  }

  getAccount(): Promise<LiveAccount> {
    return this.call('GET', '/fapi/v3/account', {}, true, value => {
      const result = row(value); strings(result, ['totalWalletBalance', 'totalUnrealizedProfit', 'totalMarginBalance', 'availableBalance']);
      rows(result.assets);
      if (result.positions !== undefined) rows(result.positions);
      return result as LiveAccount;
    });
  }
  async getPositions(symbol?: string): Promise<LivePosition[]> {
    return this.call('GET', '/fapi/v3/positionRisk', symbolParams(symbol), true, value => rows(value).map(item => {
      strings(item, ['symbol', 'positionAmt', 'entryPrice']);
      if (!['BOTH', 'LONG', 'SHORT'].includes(String(item.positionSide))) throw new Error('Invalid position side.');
      return item as LivePosition;
    }));
  }
  getPositionMode(): Promise<{ dualSidePosition: boolean }> {
    return this.call('GET', '/fapi/v1/positionSide/dual', {}, true, value => {
      const result = row(value); if (typeof result.dualSidePosition !== 'boolean') throw new Error('Missing position mode.');
      return result as { dualSidePosition: boolean };
    });
  }
  private order(value: unknown): LiveOrder {
    const result = row(value); assertSafeId(result.orderId); strings(result, ['clientOrderId', 'symbol', 'status', 'executedQty']);
    return result as LiveOrder;
  }
  async getOpenOrders(symbol?: string): Promise<LiveOrder[]> {
    return this.call('GET', '/fapi/v1/openOrders', symbolParams(symbol), true, value => rows(value).map(item => this.order(item)));
  }
  async getOpenAlgoOrders(symbol?: string): Promise<LiveAlgoOrder[]> {
    return this.call('GET', '/fapi/v1/openAlgoOrders', symbolParams(symbol), true,
      value => rows(Array.isArray(value) ? value : row(value).orders) as LiveAlgoOrder[]);
  }
  async getUserTrades(query: LiveUserTradesQuery): Promise<LiveUserTrade[]> {
    symbolParams(query.symbol); queryRange(query);
    if (query.startTime !== undefined && query.endTime !== undefined && query.endTime - query.startTime > 7 * 86400000) throw new Error('Binance trade history range exceeds seven days.');
    if (query.fromId !== undefined) {
      assertSafeId(query.fromId);
      if (query.startTime !== undefined || query.endTime !== undefined) throw new Error('Do not combine Binance trade cursor and time range.');
    }
    return this.call('GET', '/fapi/v1/userTrades', cleanParams(query), true, value => rows(value).map(item => {
      strings(item, ['symbol', 'price', 'qty', 'commission', 'commissionAsset', 'realizedPnl']);
      assertSafeId(item.id); assertSafeId(item.orderId);
      if (!Number.isSafeInteger(item.time)) throw new Error('Missing Binance trade time.');
      return item as LiveUserTrade;
    }));
  }
  async getIncome(query: LiveIncomeQuery): Promise<LiveIncome[]> {
    symbolParams(query.symbol); queryRange(query);
    if (query.page !== undefined && (!Number.isInteger(query.page) || query.page < 1)) throw new Error('Invalid Binance income page.');
    return this.call('GET', '/fapi/v1/income', cleanParams(query), true, value => rows(value).map(item => {
      strings(item, ['incomeType', 'income', 'asset']); assertSafeId(item.tranId);
      if (!Number.isSafeInteger(item.time)) throw new Error('Missing Binance income time.');
      return item as LiveIncome;
    }));
  }
  getExchangeInfo(): Promise<LiveExchangeInfo> {
    return this.call('GET', '/fapi/v1/exchangeInfo', {}, false, value => {
      const result = row(value); rows(result.symbols).forEach(item => { strings(item, ['symbol']); rows(item.filters); });
      return result as LiveExchangeInfo;
    });
  }
  async getMarkPrices(symbol?: string): Promise<LiveMarkPrice[]> {
    return this.call('GET', '/fapi/v1/premiumIndex', symbolParams(symbol), false, value => (Array.isArray(value) ? rows(value) : [row(value)]).map(item => {
      strings(item, ['symbol', 'markPrice']);
      if (!Number.isSafeInteger(item.time)) throw new Error('Missing Binance mark time.');
      return item as LiveMarkPrice;
    }));
  }
  async getTickerPrices(symbol?: string): Promise<LiveTickerPrice[]> {
    return this.call('GET', '/fapi/v2/ticker/price', symbolParams(symbol), false, value => (Array.isArray(value) ? rows(value) : [row(value)]).map(item => {
      strings(item, ['symbol', 'price']); return item as LiveTickerPrice;
    }));
  }
  async getCommissionRate(symbol: string): Promise<LiveCommissionRate> {
    return this.call('GET', '/fapi/v1/commissionRate', symbolParams(symbol), true, value => {
      const result = row(value); strings(result, ['symbol', 'makerCommissionRate', 'takerCommissionRate']); return result as LiveCommissionRate;
    });
  }
  async getSymbolConfiguration(symbol?: string): Promise<LiveSymbolConfiguration[]> {
    return this.call('GET', '/fapi/v1/symbolConfig', symbolParams(symbol), true, value => rows(value).map(item => {
      strings(item, ['symbol', 'marginType']);
      const leverage = item.leverage;
      if (!((typeof leverage === 'number' && Number.isSafeInteger(leverage) && leverage > 0)
        || (typeof leverage === 'string' && /^[1-9][0-9]*$/.test(leverage)))) throw new Error('Missing Binance symbol leverage.');
      return item as LiveSymbolConfiguration;
    }));
  }
  async getLeverageBrackets(symbol?: string): Promise<LiveRawRow[]> {
    return this.call('GET', '/fapi/v1/leverageBracket', symbolParams(symbol), true, value => Array.isArray(value) ? rows(value) : [row(value)]);
  }
  async queryOrder(symbol: string, clientOrderId: string): Promise<LiveOrder> {
    assertClientOrderId(clientOrderId);
    return this.call('GET', '/fapi/v1/order', { ...symbolParams(symbol), origClientOrderId: clientOrderId }, true, value => {
      const result = this.order(value);
      if (result.symbol !== symbol || result.clientOrderId !== clientOrderId) throw new Error('Binance queried order identity mismatch.');
      return result;
    });
  }
  async submitMarketOrder(order: LiveMarketOrderRequest): Promise<LiveOrder> {
    symbolParams(order.symbol); assertClientOrderId(order.clientOrderId);
    if (!['BUY', 'SELL'].includes(order.side) || !['BOTH', 'LONG', 'SHORT'].includes(order.positionSide)) throw new Error('Invalid Binance market order direction.');
    if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(order.quantity) || !/[1-9]/.test(order.quantity)) throw new Error('Invalid Binance market order quantity.');
    if (order.reduceOnly !== undefined && typeof order.reduceOnly !== 'boolean') throw new Error('Invalid Binance reduce-only flag.');
    if (order.positionSide !== 'BOTH' && order.reduceOnly !== undefined) throw new Error('Binance hedge mode cannot send reduceOnly.');
    const params: Record<string, string | number> = {
      symbol: order.symbol, side: order.side, type: 'MARKET', quantity: order.quantity,
      newClientOrderId: order.clientOrderId, positionSide: order.positionSide, newOrderRespType: 'RESULT',
      ...(order.reduceOnly === undefined ? {} : { reduceOnly: String(order.reduceOnly) }),
    };
    return this.call('POST', '/fapi/v1/order', params, true, value => {
      const result = this.order(value);
      if (result.symbol !== order.symbol || result.clientOrderId !== order.clientOrderId) throw new Error('Binance submitted order identity mismatch.');
      return result;
    });
  }
  async cancelOrder(symbol: string, clientOrderId: string): Promise<LiveOrder> {
    assertClientOrderId(clientOrderId);
    return this.call('DELETE', '/fapi/v1/order', { ...symbolParams(symbol), origClientOrderId: clientOrderId }, true, value => this.order(value));
  }
  async cancelAllOpenOrders(symbol: string): Promise<LiveRawRow> {
    return this.call('DELETE', '/fapi/v1/allOpenOrders', symbolParams(symbol), true, row);
  }
  async setLeverage(symbol: string, leverage: number): Promise<LiveRawRow> {
    if (!Number.isInteger(leverage) || leverage < 1 || leverage > 125) throw new Error('Invalid Binance leverage.');
    return this.call('POST', '/fapi/v1/leverage', { ...symbolParams(symbol), leverage }, true, row);
  }
}

export interface DefaultLiveBrokerOptions {
  /** Each HTTP attempt is aborted after this deadline; no deadline multiplier when retryReads=false. */
  requestTimeoutMs?: number;
  /** Disable automatic read retries for a short, predictable monitoring cycle. Writes never retry. */
  retryReads?: boolean;
}

export function createDefaultLiveBroker(settings: DefaultLiveBrokerOptions = {}): LiveBroker {
  if (settings.requestTimeoutMs !== undefined && (!Number.isSafeInteger(settings.requestTimeoutMs)
    || settings.requestTimeoutMs < 1 || settings.requestTimeoutMs > 2147483647)) {
    throw new TypeError('Invalid live broker request timeout.');
  }
  if (settings.retryReads !== undefined && typeof settings.retryReads !== 'boolean') {
    throw new TypeError('Invalid live broker read retry setting.');
  }
  const options = { transformResponse: parseLiveBinanceJson, quietErrors: true,
    executionOwner: 'CONSTANT_DIRECTION_B5_S6_DAILY15_V1',
    ...(settings.requestTimeoutMs === undefined ? {} : { timeoutMs: settings.requestTimeoutMs }) };
  let cooldownUntil = 0;
  const transport: LiveBrokerTransport = async (method, path, params, signed) => {
    if (Date.now() < cooldownUntil) throw new LiveBrokerError(method, path, -1003, false, 'rate_limit_cooldown');
    try {
      return await (method === 'GET' && settings.retryReads !== false ? requestWithRetry(method, path, params, signed, options)
        : request(method, path, params, signed, options));
    } catch (error) {
      const failure = error as { binanceCode?: number; retryAfterMs?: number };
      if (failure.binanceCode === -1003) cooldownUntil = Date.now() + Math.max(failure.retryAfterMs ?? 60_000, 60_000);
      throw error;
    }
  };
  const identity = `binance:${createHash('sha256').update(`${config.BASE_URL}\n${config.API_KEY}`).digest('hex')}`;
  return new BinanceLiveBroker(transport, identity);
}

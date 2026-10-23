import WebSocket from 'ws';
import { Decimal } from '@prisma/client/runtime/library';
import type { LiveMarkPrice, LiveTickerPrice } from './live-broker';

const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'] as const;
type Channel = 'mark' | 'book';
type ChannelState = 'stopped' | 'connecting' | 'connected' | 'reconnecting';

/** The public feed never receives credentials and cannot place or amend orders. */
export interface LiveQuoteSocket {
  on(event: 'open' | 'message' | 'close' | 'error' | 'pong', listener: (...args: any[]) => void): unknown;
  ping(): void;
  terminate(): void;
}
export interface LiveQuoteFeedOptions {
  symbols?: readonly string[];
  maxQuoteAgeMs?: number;
  now?: () => number;
  socketFactory?: (url: string) => LiveQuoteSocket;
}
export interface LiveQuoteFeedHealth {
  running: boolean;
  ready: boolean;
  maxQuoteAgeMs: number;
  channels: Record<Channel, {
    state: ChannelState; lastMessageAtMs: number | null; reconnects: number;
    lastError: string | null; missingOrStaleSymbols: string[];
  }>;
}
export interface LiveBookTickerPrice extends LiveTickerPrice {
  time: number;
  bidPrice: string;
  askPrice: string;
  receivedAtMs: number;
  quoteSource: 'websocket_book_midpoint';
}
interface Cached<T> { row: T; receivedAtMs: number; eventTimeMs: number; }
interface Connection {
  state: ChannelState;
  socket?: LiveQuoteSocket;
  generation: number;
  openedAtMs: number | null;
  connectedAtMs: number | null;
  lastMessageAtMs: number | null;
  awaitingPongAtMs: number | null;
  lastPingAtMs: number | null;
  reconnects: number;
  failures: number;
  lastError: string | null;
  reconnectTimer?: ReturnType<typeof setTimeout>;
}

export class LiveQuoteFeedError extends Error {
  readonly name = 'LiveQuoteFeedError';
  constructor(readonly channel: Channel, readonly symbol: string,
    readonly reason: 'missing' | 'stale' | 'disconnected' | 'unknown_symbol') {
    super(`Live public ${channel} quote unavailable for ${symbol} (${reason}).`);
  }
}

/**
 * USD-M public quotes, split across Binance's current /market and /public routes.
 * Event E is retained: receipt, heartbeat, reconnect, or reads never refresh a price.
 * A disconnected socket invalidates its cache even when the last event was recent.
 */
export class LiveQuoteFeed {
  private readonly symbols: readonly string[];
  private readonly maxQuoteAgeMs: number;
  private readonly now: () => number;
  private readonly socketFactory: (url: string) => LiveQuoteSocket;
  private readonly marks = new Map<string, Cached<LiveMarkPrice>>();
  private readonly books = new Map<string, Cached<LiveBookTickerPrice>>();
  private readonly connections: Record<Channel, Connection> = {
    mark: LiveQuoteFeed.connection(), book: LiveQuoteFeed.connection(),
  };
  private running = false;
  private timer?: ReturnType<typeof setInterval>;

  constructor(options: LiveQuoteFeedOptions = {}) {
    this.symbols = [...(options.symbols ?? DEFAULT_SYMBOLS)];
    if (!this.symbols.length || this.symbols.length > 20 || new Set(this.symbols).size !== this.symbols.length
      || this.symbols.some(symbol => !/^[A-Z0-9]{2,30}$/.test(symbol))) throw new Error('Invalid live quote symbols.');
    this.maxQuoteAgeMs = options.maxQuoteAgeMs ?? 5_000;
    if (!Number.isInteger(this.maxQuoteAgeMs) || this.maxQuoteAgeMs < 1 || this.maxQuoteAgeMs > 5_000) {
      throw new Error('Live quote freshness must be between 1 and 5000 ms.');
    }
    this.now = options.now ?? Date.now;
    this.socketFactory = options.socketFactory ?? (url => new WebSocket(url, {
      handshakeTimeout: 10_000, maxPayload: 64 * 1024, perMessageDeflate: false,
    }));
  }

  private static connection(): Connection {
    return { state: 'stopped', generation: 0, openedAtMs: null, connectedAtMs: null,
      lastMessageAtMs: null, awaitingPongAtMs: null, lastPingAtMs: null,
      reconnects: 0, failures: 0, lastError: null };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.connect('mark');
    this.connect('book');
    this.timer = setInterval(() => this.checkConnections(), 1_000);
    this.timer.unref?.();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const channel of ['mark', 'book'] as const) {
      const connection = this.connections[channel];
      connection.generation++;
      if (connection.reconnectTimer) clearTimeout(connection.reconnectTimer);
      connection.reconnectTimer = undefined;
      const socket = connection.socket;
      connection.socket = undefined;
      connection.state = 'stopped';
      connection.failures = 0;
      try { socket?.terminate(); } catch { /* No transport error leaks into the risk loop. */ }
    }
    this.marks.clear();
    this.books.clear();
  }

  health(): LiveQuoteFeedHealth {
    const now = this.now();
    const channels = Object.fromEntries((['mark', 'book'] as const).map(channel => {
      const connection = this.connections[channel];
      const missingOrStaleSymbols = this.symbols.filter(symbol => {
        const cached = this.cached(channel, symbol);
        return connection.state !== 'connected' || !cached || !this.isFresh(cached, now);
      });
      return [channel, { state: connection.state, lastMessageAtMs: connection.lastMessageAtMs,
        reconnects: connection.reconnects, lastError: connection.lastError, missingOrStaleSymbols }];
    })) as LiveQuoteFeedHealth['channels'];
    return { running: this.running, ready: this.running && channels.mark.missingOrStaleSymbols.length === 0
      && channels.book.missingOrStaleSymbols.length === 0, maxQuoteAgeMs: this.maxQuoteAgeMs, channels };
  }

  async getMarkPrices(symbol?: string): Promise<LiveMarkPrice[]> {
    return this.read('mark', symbol) as LiveMarkPrice[];
  }

  async getTickerPrices(symbol?: string): Promise<LiveBookTickerPrice[]> {
    return this.read('book', symbol) as LiveBookTickerPrice[];
  }

  private cached(channel: Channel, symbol: string): Cached<LiveMarkPrice | LiveBookTickerPrice> | undefined {
    return channel === 'mark' ? this.marks.get(symbol) : this.books.get(symbol);
  }

  private isFresh(cached: Cached<unknown>, now: number): boolean {
    const receivedAge = now - cached.receivedAtMs, eventAge = now - cached.eventTimeMs;
    return receivedAge >= 0 && receivedAge <= this.maxQuoteAgeMs
      && eventAge >= -1_000 && eventAge <= this.maxQuoteAgeMs;
  }

  private read(channel: Channel, symbol?: string): (LiveMarkPrice | LiveBookTickerPrice)[] {
    if (symbol !== undefined && !this.symbols.includes(symbol)) throw new LiveQuoteFeedError(channel, symbol, 'unknown_symbol');
    const now = this.now();
    return (symbol === undefined ? this.symbols : [symbol]).map(item => {
      if (!this.running || this.connections[channel].state !== 'connected') throw new LiveQuoteFeedError(channel, item, 'disconnected');
      const cached = this.cached(channel, item);
      if (!cached) throw new LiveQuoteFeedError(channel, item, 'missing');
      if (!this.isFresh(cached, now)) throw new LiveQuoteFeedError(channel, item, 'stale');
      return { ...cached.row };
    });
  }

  private connect(channel: Channel): void {
    if (!this.running) return;
    const connection = this.connections[channel], generation = ++connection.generation;
    connection.state = 'connecting';
    connection.openedAtMs = this.now();
    connection.connectedAtMs = null;
    connection.lastMessageAtMs = null;
    connection.awaitingPongAtMs = null;
    connection.lastPingAtMs = null;
    const suffix = channel === 'mark' ? 'markPrice@1s' : 'bookTicker';
    const streams = this.symbols.map(symbol => `${symbol.toLowerCase()}@${suffix}`).join('/');
    const url = `wss://fstream.binance.com/${channel === 'mark' ? 'market' : 'public'}/stream?streams=${streams}`;
    let socket: LiveQuoteSocket;
    try { socket = this.socketFactory(url); } catch { this.reconnect(channel, generation, 'connect_failed'); return; }
    connection.socket = socket;
    const isCurrent = (): boolean => this.running && connection.generation === generation;
    socket.on('open', () => {
      if (!isCurrent()) return;
      connection.state = 'connected';
      connection.connectedAtMs = this.now();
      connection.lastPingAtMs = this.now();
    });
    socket.on('message', (raw: unknown) => {
      if (isCurrent() && connection.state === 'connected') this.accept(channel, raw);
    });
    socket.on('pong', () => { if (isCurrent()) connection.awaitingPongAtMs = null; });
    socket.on('close', () => { if (isCurrent()) this.reconnect(channel, generation, 'socket_closed'); });
    socket.on('error', () => { if (isCurrent()) this.reconnect(channel, generation, 'socket_error'); });
  }

  private reconnect(channel: Channel, generation: number, reason: string): void {
    const connection = this.connections[channel];
    if (!this.running || generation !== connection.generation) return;
    connection.generation++;
    const socket = connection.socket;
    connection.socket = undefined;
    connection.state = 'reconnecting';
    connection.lastError = reason;
    connection.reconnects++;
    (channel === 'mark' ? this.marks : this.books).clear();
    try { socket?.terminate(); } catch { /* Do not propagate socket details. */ }
    const delay = Math.min(500 * 2 ** Math.min(connection.failures++, 6), 15_000);
    connection.reconnectTimer = setTimeout(() => {
      connection.reconnectTimer = undefined;
      this.connect(channel);
    }, delay);
    connection.reconnectTimer.unref?.();
  }

  private checkConnections(): void {
    const now = this.now();
    for (const channel of ['mark', 'book'] as const) {
      const connection = this.connections[channel];
      if (connection.state === 'connecting' && connection.openedAtMs !== null && now - connection.openedAtMs > 10_000) {
        this.reconnect(channel, connection.generation, 'connect_timeout');
      } else if (connection.state === 'connected') {
        const lastData = connection.lastMessageAtMs ?? connection.connectedAtMs ?? now;
        // Traffic from four symbols cannot hide a stalled fifth subscription.
        // Keep the same 10s warmup/watchdog, without refreshing any price time.
        const stalledSymbol = this.symbols.some(symbol => {
          const lastReceived = this.cached(channel, symbol)?.receivedAtMs ?? connection.connectedAtMs;
          return lastReceived !== null && now - lastReceived > 10_000;
        });
        if (now - lastData > 10_000) this.reconnect(channel, connection.generation, 'data_timeout');
        else if (stalledSymbol) this.reconnect(channel, connection.generation, 'symbol_data_timeout');
        else if (connection.connectedAtMs !== null && now - connection.connectedAtMs > 23 * 60 * 60 * 1_000) {
          this.reconnect(channel, connection.generation, 'scheduled_rotation');
        } else if (connection.awaitingPongAtMs !== null && now - connection.awaitingPongAtMs > 10_000) {
          this.reconnect(channel, connection.generation, 'pong_timeout');
        } else if (connection.awaitingPongAtMs === null && connection.lastPingAtMs !== null && now - connection.lastPingAtMs >= 15_000) {
          connection.lastPingAtMs = now;
          connection.awaitingPongAtMs = now;
          try { connection.socket?.ping(); } catch { this.reconnect(channel, connection.generation, 'ping_failed'); }
        }
      }
    }
  }

  private accept(channel: Channel, raw: unknown): void {
    try {
      const body = JSON.parse(typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : '') as Record<string, unknown>;
      const data = (body.data ?? body) as Record<string, unknown>;
      const symbol = data.s, eventTime = data.E, now = this.now();
      if (typeof symbol !== 'string' || !this.symbols.includes(symbol) || !Number.isSafeInteger(eventTime)
        || Number(eventTime) <= 0 || now - Number(eventTime) > this.maxQuoteAgeMs || Number(eventTime) - now > 1_000
        || (data.st !== undefined && data.st !== 1)) return;
      const expectedStream = `${symbol.toLowerCase()}@${channel === 'mark' ? 'markPrice@1s' : 'bookTicker'}`;
      if (body.stream !== undefined && body.stream !== expectedStream) return;
      const previous = this.cached(channel, symbol);
      // Replayed or reordered events do not extend the receipt freshness of a price.
      if (previous && Number(eventTime) <= previous.eventTimeMs) return;
      const positivePrice = (value: unknown): value is string => typeof value === 'string' && value.length <= 80
        && /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value) && new Money(value).gt(0);
      if (channel === 'mark') {
        if (data.e !== 'markPriceUpdate' || !positivePrice(data.p)) return;
        this.marks.set(symbol, { row: { symbol, markPrice: data.p, time: Number(eventTime),
          receivedAtMs: now, quoteSource: 'websocket_mark_price' }, receivedAtMs: now, eventTimeMs: Number(eventTime) });
      } else {
        if (data.e !== 'bookTicker' || !positivePrice(data.b) || !positivePrice(data.a) || new Money(data.b).gt(data.a)) return;
        this.books.set(symbol, { row: { symbol, price: new Money(data.b).plus(data.a).div(2).toString(),
          bidPrice: data.b, askPrice: data.a, time: Number(eventTime), receivedAtMs: now,
          quoteSource: 'websocket_book_midpoint' }, receivedAtMs: now, eventTimeMs: Number(eventTime) });
      }
      const connection = this.connections[channel];
      connection.lastMessageAtMs = now;
      connection.failures = 0;
      connection.lastError = null;
    } catch { /* Invalid public messages cannot alter cached quotes or stop monitoring. */ }
  }
}

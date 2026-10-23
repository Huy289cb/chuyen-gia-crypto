import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveQuoteFeed, LiveQuoteFeedError } from '../../src/portfolio/live-quotes';
import type { LiveQuoteSocket } from '../../src/portfolio/live-quotes';

const INITIAL_TIME = 1_792_262_000_000;
class FakeSocket extends EventEmitter implements LiveQuoteSocket {
  readonly ping = vi.fn();
  readonly terminate = vi.fn();
}
const feeds: LiveQuoteFeed[] = [];
function setup(symbols = ['BTCUSDT']) {
  const sockets: { url: string; socket: FakeSocket }[] = [];
  const feed = new LiveQuoteFeed({ symbols, socketFactory: url => {
    const socket = new FakeSocket(); sockets.push({ url, socket }); return socket;
  } });
  feeds.push(feed);
  feed.start();
  sockets.forEach(item => item.socket.emit('open'));
  return { feed, sockets, mark: sockets[0].socket, book: sockets[1].socket };
}
function mark(socket: FakeSocket, time = Date.now(), symbol = 'BTCUSDT', price = '100.00000001') {
  socket.emit('message', Buffer.from(JSON.stringify({ stream: `${symbol.toLowerCase()}@markPrice@1s`,
    data: { e: 'markPriceUpdate', E: time, s: symbol, p: price } })));
}
function book(socket: FakeSocket, time = Date.now(), symbol = 'BTCUSDT', bid = '99.00000001', ask = '101.00000002') {
  socket.emit('message', JSON.stringify({ stream: `${symbol.toLowerCase()}@bookTicker`,
    data: { e: 'bookTicker', E: time, T: time - 1, s: symbol, b: bid, a: ask, st: 1 } }));
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(INITIAL_TIME); });
afterEach(() => { feeds.splice(0).forEach(feed => feed.stop()); vi.useRealTimers(); });

describe('live public WebSocket quotes', () => {
  it('uses Binance category endpoints and raw prices, exact midpoint, original event timestamps', async () => {
    const s = setup(['BTCUSDT', 'ETHUSDT']);
    expect(s.sockets.map(item => item.url)).toEqual([
      'wss://fstream.binance.com/market/stream?streams=btcusdt@markPrice@1s/ethusdt@markPrice@1s',
      'wss://fstream.binance.com/public/stream?streams=btcusdt@bookTicker/ethusdt@bookTicker',
    ]);
    mark(s.mark, Date.now() - 350);
    book(s.book, Date.now() - 220);
    expect(await s.feed.getMarkPrices('BTCUSDT')).toEqual([{ symbol: 'BTCUSDT', markPrice: '100.00000001',
      time: INITIAL_TIME - 350, receivedAtMs: INITIAL_TIME, quoteSource: 'websocket_mark_price' }]);
    expect((await s.feed.getTickerPrices('BTCUSDT'))[0]).toEqual({ symbol: 'BTCUSDT', price: '100.000000015',
      bidPrice: '99.00000001', askPrice: '101.00000002', time: INITIAL_TIME - 220,
      receivedAtMs: INITIAL_TIME, quoteSource: 'websocket_book_midpoint' });
    expect(s.feed.health().ready).toBe(false);
    mark(s.mark, Date.now(), 'ETHUSDT'); book(s.book, Date.now(), 'ETHUSDT');
    expect(s.feed.health().ready).toBe(true);
    const returned = await s.feed.getMarkPrices('BTCUSDT'); returned[0].markPrice = '1';
    expect((await s.feed.getMarkPrices('BTCUSDT'))[0].markPrice).toBe('100.00000001');
  });

  it('never turns an old venue timestamp into a fresh quote on receipt or read', async () => {
    const s = setup(); mark(s.mark, Date.now() - 5_001); book(s.book, Date.now() - 5_001);
    await expect(s.feed.getMarkPrices()).rejects.toMatchObject({ reason: 'missing' });
    await expect(s.feed.getTickerPrices()).rejects.toMatchObject({ reason: 'missing' });
    mark(s.mark, Date.now() - 4_800); book(s.book, Date.now() - 4_800);
    await vi.advanceTimersByTimeAsync(201);
    await expect(s.feed.getMarkPrices()).rejects.toMatchObject({ reason: 'stale' });
    await expect(s.feed.getTickerPrices()).rejects.toMatchObject({ reason: 'stale' });
    expect(s.feed.health().ready).toBe(false);
  });

  it('does not refresh receipt freshness for duplicates, reordered events, pongs, or unrelated symbols', async () => {
    const s = setup(); mark(s.mark); book(s.book);
    await vi.advanceTimersByTimeAsync(4_000);
    mark(s.mark, INITIAL_TIME); mark(s.mark, INITIAL_TIME - 1); mark(s.mark, Date.now(), 'ETHUSDT');
    s.mark.emit('pong');
    const quote = (await s.feed.getMarkPrices())[0];
    expect(quote.time).toBe(INITIAL_TIME); expect(quote.receivedAtMs).toBe(INITIAL_TIME);
    await vi.advanceTimersByTimeAsync(1_001);
    await expect(s.feed.getMarkPrices()).rejects.toMatchObject({ reason: 'stale' });
  });

  it('rejects invalid messages, future timestamps, crossed books, wrong stream and non-UM data', async () => {
    const s = setup();
    for (const value of ['invalid', '{}', JSON.stringify({ data: { e: 'markPriceUpdate', s: 'BTCUSDT', E: Date.now(), p: '-1' } })]) {
      s.mark.emit('message', value);
    }
    mark(s.mark, Date.now() + 1_001); mark(s.mark, Date.now(), 'BTCUSDT', 'NaN');
    book(s.book, Date.now(), 'BTCUSDT', '102', '101');
    s.book.emit('message', JSON.stringify({ stream: 'ethusdt@bookTicker', data: {
      e: 'bookTicker', s: 'BTCUSDT', E: Date.now(), b: '99', a: '101', st: 1 } }));
    s.book.emit('message', JSON.stringify({ data: { e: 'bookTicker', s: 'BTCUSDT', E: Date.now(), b: '99', a: '101', st: 2 } }));
    await expect(s.feed.getMarkPrices()).rejects.toMatchObject({ reason: 'missing' });
    await expect(s.feed.getTickerPrices()).rejects.toMatchObject({ reason: 'missing' });
    expect(() => s.mark.emit('message', null)).not.toThrow();
    mark(s.mark); book(s.book); expect(s.feed.health().ready).toBe(true);
  });

  it('invalidates only the failed category immediately and ignores late old-socket events after reconnect', async () => {
    const s = setup(); mark(s.mark); book(s.book);
    s.mark.emit('error', new Error('private untrusted transport details'));
    expect(s.mark.terminate).toHaveBeenCalledTimes(1);
    await expect(s.feed.getMarkPrices()).rejects.toMatchObject({ reason: 'disconnected' });
    expect(await s.feed.getTickerPrices()).toHaveLength(1);
    expect(JSON.stringify(s.feed.health())).not.toContain('private');
    await vi.advanceTimersByTimeAsync(500);
    expect(s.sockets).toHaveLength(3);
    const replacement = s.sockets[2].socket;
    replacement.emit('open');
    mark(s.mark); s.mark.emit('close');
    await expect(s.feed.getMarkPrices()).rejects.toMatchObject({ reason: 'missing' });
    mark(replacement); expect(await s.feed.getMarkPrices()).toHaveLength(1);
    expect(s.feed.health().channels.mark.reconnects).toBe(1);
  });

  it('backs off repeated connect failures within 15 seconds without overlapping retries', async () => {
    const s = setup();
    for (const delay of [500, 1_000, 2_000, 4_000, 8_000, 15_000, 15_000]) {
      const current = s.sockets.filter(item => item.url.includes('/market/')).at(-1)!.socket;
      current.emit('error', new Error('failure')); current.emit('close');
      const priorCount = s.sockets.filter(item => item.url.includes('/market/')).length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(s.sockets.filter(item => item.url.includes('/market/'))).toHaveLength(priorCount);
      await vi.advanceTimersByTimeAsync(1);
      expect(s.sockets.filter(item => item.url.includes('/market/'))).toHaveLength(priorCount + 1);
    }
  });

  it('reconnects a connected socket whose data stream stalls even if the socket remains open', async () => {
    const s = setup(); mark(s.mark); book(s.book);
    await vi.advanceTimersByTimeAsync(11_000);
    expect(s.feed.health().channels.mark).toMatchObject({ state: 'reconnecting', lastError: 'data_timeout' });
    expect(s.feed.health().channels.book).toMatchObject({ state: 'reconnecting', lastError: 'data_timeout' });
    expect(s.mark.terminate).toHaveBeenCalledTimes(1); expect(s.book.terminate).toHaveBeenCalledTimes(1);
  });

  it('reconnects one frozen constituent despite traffic and pongs from the other symbol', async () => {
    const s = setup(['BTCUSDT', 'ETHUSDT']);
    mark(s.mark); mark(s.mark, Date.now(), 'ETHUSDT'); book(s.book); book(s.book, Date.now(), 'ETHUSDT');
    for (let i = 0; i < 11; i++) {
      mark(s.mark); mark(s.mark, Date.now(), 'ETHUSDT'); book(s.book, Date.now(), 'ETHUSDT');
      s.mark.emit('pong'); s.book.emit('pong'); await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(s.feed.health().channels.book).toMatchObject({ state: 'reconnecting', lastError: 'symbol_data_timeout', reconnects: 1 });
    expect(s.feed.health().channels.mark.reconnects).toBe(0); expect(s.book.terminate).toHaveBeenCalledTimes(1);
    await expect(s.feed.getTickerPrices()).rejects.toMatchObject({ reason: 'disconnected' });
    await vi.advanceTimersByTimeAsync(500);
    const replacement = s.sockets[2].socket; replacement.emit('open');
    await expect(s.feed.getTickerPrices()).rejects.toMatchObject({ reason: 'missing' });
    // Late events on the former connection cannot repopulate its invalid cache.
    book(s.book); await expect(s.feed.getTickerPrices()).rejects.toMatchObject({ reason: 'missing' });
    book(replacement); book(replacement, Date.now(), 'ETHUSDT');
    expect(s.feed.health().ready).toBe(true);
    expect((await s.feed.getTickerPrices('BTCUSDT'))[0].time).toBe(Date.now());
  });

  it('allows a missing constituent its full10second warmup before reconnecting', async () => {
    const s = setup(['BTCUSDT', 'ETHUSDT']);
    for (let i = 0; i < 10; i++) {
      mark(s.mark); mark(s.mark, Date.now(), 'ETHUSDT'); book(s.book, Date.now(), 'ETHUSDT');
      s.mark.emit('pong'); s.book.emit('pong'); await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(s.feed.health().channels.book).toMatchObject({ state: 'connected', reconnects: 0 });
    await expect(s.feed.getTickerPrices()).rejects.toMatchObject({ reason: 'missing' });
    book(s.book); mark(s.mark); mark(s.mark, Date.now(), 'ETHUSDT');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(s.feed.health().channels.book).toMatchObject({ state: 'connected', reconnects: 0 });
    expect(s.feed.health().ready).toBe(true);
  });

  it('pings active streams and reconnects when pong is missing without falsifying quote time', async () => {
    const s = setup();
    for (let i = 0; i < 26; i++) {
      mark(s.mark); book(s.book);
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(s.mark.ping).toHaveBeenCalledTimes(1); expect(s.book.ping).toHaveBeenCalledTimes(1);
    expect(s.feed.health().channels.mark.lastError).toBe('pong_timeout');
    expect(s.feed.health().channels.book.lastError).toBe('pong_timeout');
  });

  it('accepts pongs and keeps a healthy feed connected', async () => {
    const s = setup();
    for (let i = 0; i < 35; i++) {
      mark(s.mark); book(s.book); s.mark.emit('pong'); s.book.emit('pong');
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(s.feed.health().ready).toBe(true);
    expect(s.feed.health().channels.mark.reconnects).toBe(0);
    expect(s.mark.ping).toHaveBeenCalledTimes(2);
  });

  it('handles handshake failure, stop, and restart without stale data or zombie retries', async () => {
    const sockets: FakeSocket[] = [];
    const feed = new LiveQuoteFeed({ symbols: ['BTCUSDT'], socketFactory: () => {
      const socket = new FakeSocket(); sockets.push(socket); return socket;
    } }); feeds.push(feed); feed.start(); feed.start(); expect(sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(11_000);
    expect(feed.health().channels.mark.lastError).toBe('connect_timeout');
    feed.stop(); await vi.advanceTimersByTimeAsync(30_000); expect(sockets).toHaveLength(2);
    await expect(feed.getMarkPrices()).rejects.toBeInstanceOf(LiveQuoteFeedError);
    feed.start(); expect(sockets).toHaveLength(4);
    sockets[2].emit('open'); sockets[3].emit('open');
    await expect(feed.getMarkPrices()).rejects.toMatchObject({ reason: 'missing' });
    mark(sockets[2]); book(sockets[3]); expect(feed.health().ready).toBe(true);
  });

  it('rejects unsupported symbol requests and a freshness allowance above five seconds', async () => {
    const s = setup();
    await expect(s.feed.getMarkPrices('UNKNOWN')).rejects.toMatchObject({ reason: 'unknown_symbol' });
    expect(() => new LiveQuoteFeed({ maxQuoteAgeMs: 5_001 })).toThrow('5000');
    expect(() => new LiveQuoteFeed({ symbols: ['BTCUSDT', 'BTCUSDT'] })).toThrow('symbols');
  });
});

import { describe, it, expect } from 'vitest';
import { aggregateUserTradesToRounds } from '../../src/services/binance-trade-history.service';

describe('aggregateUserTradesToRounds', () => {
  it('builds one closed long round from open and close fills', () => {
    const rounds = aggregateUserTradesToRounds(
      [
        { side: 'BUY', price: 100, qty: 1, commission: 0.1, realizedPnl: 0, time: 1000, orderId: 1 },
        { side: 'SELL', price: 110, qty: 1, commission: 0.1, realizedPnl: 10, time: 2000, orderId: 2 },
      ],
      'BTC'
    );

    expect(rounds).toHaveLength(1);
    expect(rounds[0].side).toBe('long');
    expect(rounds[0].entryPrice).toBe(100);
    expect(rounds[0].closePrice).toBe(110);
    expect(rounds[0].realizedPnL).toBe(10);
    expect(rounds[0].closeReason).toBe('binance_fills');
  });

  it('builds closed short round', () => {
    const rounds = aggregateUserTradesToRounds(
      [
        { side: 'SELL', price: 200, qty: 2, commission: 0.2, realizedPnl: 0, time: 1000, orderId: 1 },
        { side: 'BUY', price: 190, qty: 2, commission: 0.2, realizedPnl: 20, time: 2000, orderId: 2 },
      ],
      'BTC'
    );

    expect(rounds).toHaveLength(1);
    expect(rounds[0].side).toBe('short');
    expect(rounds[0].entryPrice).toBe(200);
    expect(rounds[0].closePrice).toBe(190);
  });

  it('returns newest rounds first', () => {
    const rounds = aggregateUserTradesToRounds(
      [
        { side: 'BUY', price: 100, qty: 1, commission: 0, realizedPnl: 0, time: 1000, orderId: 1 },
        { side: 'SELL', price: 101, qty: 1, commission: 0, realizedPnl: 1, time: 2000, orderId: 2 },
        { side: 'BUY', price: 200, qty: 1, commission: 0, realizedPnl: 0, time: 3000, orderId: 3 },
        { side: 'SELL', price: 210, qty: 1, commission: 0, realizedPnl: 10, time: 4000, orderId: 4 },
      ],
      'BTC'
    );

    expect(rounds).toHaveLength(2);
    expect(rounds[0].entryPrice).toBe(200);
    expect(rounds[1].entryPrice).toBe(100);
  });
});

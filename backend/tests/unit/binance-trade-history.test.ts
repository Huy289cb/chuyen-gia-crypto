import { describe, it, expect } from 'vitest';
import {
  aggregateUserTradesToRounds,
  computeLossStreakFromRounds,
  type BinanceTradeRound,
} from '../../src/services/binance-trade-history.service';

function round(realizedPnL: number, fee: number, closedAt: string): BinanceTradeRound {
  return {
    id: `r_${closedAt}`,
    symbol: 'BTC',
    side: 'short',
    entryPrice: 100,
    closePrice: 100,
    quantity: 0.01,
    fee,
    realizedPnL,
    closeReason: 'binance_fills',
    status: 'closed',
    closedAt,
  };
}

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

  it('excludes the still-open position (no closing fill)', () => {
    const rounds = aggregateUserTradesToRounds(
      [
        { side: 'BUY', price: 100, qty: 1, commission: 0, realizedPnl: 0, time: 1000, orderId: 1 },
        { side: 'SELL', price: 110, qty: 1, commission: 0, realizedPnl: 10, time: 2000, orderId: 2 },
        // new open position, not yet closed
        { side: 'SELL', price: 105, qty: 1, commission: 0, realizedPnl: 0, time: 3000, orderId: 3 },
      ],
      'BTC'
    );

    expect(rounds).toHaveLength(1);
    expect(rounds[0].side).toBe('long');
  });

  it('does not emit phantom PnL=0 rounds when entry/exit qty drift (regression)', () => {
    // Reproduces production noise: net-based aggregation spawned phantom
    // "long qty 0.012 PnL 0" rounds between back-to-back shorts.
    const rounds = aggregateUserTradesToRounds(
      [
        { side: 'SELL', price: 61274.6, qty: 0.0325, commission: 0.4, realizedPnl: 0, time: 1000, orderId: 1 },
        { side: 'BUY', price: 61219.5, qty: 0.0325, commission: 0.8, realizedPnl: 1.79, time: 2000, orderId: 2 },
        { side: 'SELL', price: 60842, qty: 0.0308, commission: 0.7, realizedPnl: 0, time: 3000, orderId: 3 },
        { side: 'BUY', price: 61285.2, qty: 0.0328, commission: 0.8, realizedPnl: -14.46, time: 4000, orderId: 4 },
      ],
      'BTC'
    );

    expect(rounds).toHaveLength(2);
    expect(rounds.every((r) => r.side === 'short')).toBe(true);
    expect(rounds.some((r) => r.realizedPnL === 0)).toBe(false);
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

  it('does not emit phantom dust round when close over-shoots by float drift', () => {
    // Open 0.0325 long, close with 0.0326 (over-close by 0.0001) → net drifts to -0.0001.
    const rounds = aggregateUserTradesToRounds(
      [
        { side: 'BUY', price: 60000, qty: 0.0325, commission: 0.1, realizedPnl: 0, time: 1000, orderId: 1 },
        { side: 'SELL', price: 61000, qty: 0.0326, commission: 0.1, realizedPnl: 32.5, time: 2000, orderId: 2 },
      ],
      'BTC'
    );

    expect(rounds).toHaveLength(1);
    expect(rounds[0].side).toBe('long');
    expect(rounds[0].quantity).toBeCloseTo(0.0325, 6);
  });

  it('drops a negligible dust-sized round', () => {
    const rounds = aggregateUserTradesToRounds(
      [
        { side: 'BUY', price: 100, qty: 0.0001, commission: 0, realizedPnl: 0, time: 1000, orderId: 1 },
        { side: 'SELL', price: 100, qty: 0.0001, commission: 0, realizedPnl: 0.0001, time: 2000, orderId: 2 },
      ],
      'BTC'
    );

    expect(rounds.every((r) => r.quantity >= 5e-4)).toBe(true);
  });
});

describe('computeLossStreakFromRounds', () => {
  it('counts leading consecutive losses (newest first)', () => {
    const streak = computeLossStreakFromRounds([
      round(-20, 1.5, '2026-06-25T14:00:00.000Z'),
      round(-25, 1.0, '2026-06-25T13:00:00.000Z'),
      round(-14, 0.8, '2026-06-25T12:00:00.000Z'),
      round(30, 0.8, '2026-06-25T11:00:00.000Z'),
    ]);
    expect(streak.consecutiveLosses).toBe(3);
    expect(streak.lastLossTime).toBe(new Date('2026-06-25T14:00:00.000Z').getTime());
  });

  it('stops counting at first win', () => {
    const streak = computeLossStreakFromRounds([
      round(10, 0.5, '2026-06-25T14:00:00.000Z'),
      round(-25, 1.0, '2026-06-25T13:00:00.000Z'),
    ]);
    expect(streak.consecutiveLosses).toBe(0);
    expect(streak.lastLossTime).toBe(0);
  });

  it('treats fee-driven net loss as a loss', () => {
    // gross +0.5 but fee 1.0 → net -0.5 = loss
    const streak = computeLossStreakFromRounds([round(0.5, 1.0, '2026-06-25T14:00:00.000Z')]);
    expect(streak.consecutiveLosses).toBe(1);
  });

  it('returns zero streak when no rounds', () => {
    const streak = computeLossStreakFromRounds([]);
    expect(streak.consecutiveLosses).toBe(0);
    expect(streak.lastLossTime).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import {
  breachedDailyLoss,
  gridTakeProfitIndexes,
  momentumStops,
  nextGridBuy,
  quantityForNotional,
  selectMomentum,
} from '../../src/portfolio/hybrid-live-plan';

describe('hybrid live plan', () => {
  it('sizes a 25 USDT ticket onto the exchange step', () => {
    expect(quantityForNotional(25, 100, '0.001', '0.001', '5')).toBe('0.250');
    expect(quantityForNotional(25, 100000, '0.001', '0.001', '5')).toBeNull();
  });

  it('keeps the two strongest names above 2 percent', () => {
    const series = (past: number, latest: number) => [past, ...Array(13).fill(past), latest];
    const picked = selectMomentum({
      SOLUSDT: series(100, 150),
      BNBUSDT: series(100, 130),
      DOGEUSDT: series(100, 101),
      ETHUSDT: series(100, 90),
    });
    expect(picked).toEqual(['SOLUSDT', 'BNBUSDT']);
  });

  it('stops a momentum leg at 12 percent and flags a 12 USDT day', () => {
    expect(momentumStops({ momentum: [{ symbol: 'SOLUSDT', entry: 100, qty: 0.25 }], grid: [], daysSinceRebalance: 0 }, { SOLUSDT: 88 })).toEqual(['SOLUSDT']);
    expect(momentumStops({ momentum: [{ symbol: 'SOLUSDT', entry: 100, qty: 0.25 }], grid: [], daysSinceRebalance: 0 }, { SOLUSDT: 89 })).toEqual([]);
    expect(breachedDailyLoss(-12)).toBe(true);
    expect(breachedDailyLoss(-11.99)).toBe(false);
  });

  it('buys the BTC grid only under the dip and outside the crash gate', () => {
    const calm = [...Array(10).fill(100), 96];
    expect(nextGridBuy({ momentum: [], grid: [], daysSinceRebalance: 0 }, calm)).toEqual({ notional: 15 });
    const crash = [...Array(10).fill(100), 93];
    expect(nextGridBuy({ momentum: [], grid: [], daysSinceRebalance: 0 }, crash)).toBeNull();
    expect(gridTakeProfitIndexes({
      momentum: [],
      grid: [{ entry: 100, qty: 0.15, tp: 103 }],
      daysSinceRebalance: 0,
    }, 103)).toEqual([0]);
  });
});

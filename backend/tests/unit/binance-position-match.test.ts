import { describe, it, expect } from 'vitest';
import {
  findBinancePositionForSide,
  listActiveBinancePositions,
  localSideFromPositionAmt,
} from '../../src/utils/binance-position-match';

describe('binance-position-match', () => {
  it('parses ONE_WAY BOTH long', () => {
    const rows = [
      {
        symbol: 'BTCUSDT',
        positionAmt: '0.04',
        entryPrice: '73648.74',
        markPrice: '73100',
        positionSide: 'BOTH',
      },
    ];
    const active = listActiveBinancePositions(rows);
    expect(active).toHaveLength(1);
    expect(active[0].side).toBe('long');
    expect(active[0].positionAmt).toBe(0.04);
  });

  it('finds position by symbol and side (not LONG key)', () => {
    const rows = [
      {
        symbol: 'BTCUSDT',
        positionAmt: '-0.01',
        positionSide: 'BOTH',
      },
    ];
    expect(findBinancePositionForSide(rows, 'BTC', 'short')?.positionAmt).toBe(0.01);
    expect(findBinancePositionForSide(rows, 'BTC', 'long')).toBeNull();
  });

  it('localSideFromPositionAmt', () => {
    expect(localSideFromPositionAmt(0.01)).toBe('long');
    expect(localSideFromPositionAmt(-0.01)).toBe('short');
    expect(localSideFromPositionAmt(0)).toBeNull();
  });
});

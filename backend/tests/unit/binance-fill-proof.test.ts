import { describe, it, expect } from 'vitest';
import { hasBinanceFillProof } from '../../src/utils/binance-fill-proof';

describe('hasBinanceFillProof', () => {
  it('returns true when binance_order_id is set', () => {
    expect(hasBinanceFillProof({ binance_order_id: '15243540740' })).toBe(true);
  });

  it('returns false for null, empty, or whitespace', () => {
    expect(hasBinanceFillProof({ binance_order_id: null })).toBe(false);
    expect(hasBinanceFillProof({ binance_order_id: '' })).toBe(false);
    expect(hasBinanceFillProof({ binance_order_id: '   ' })).toBe(false);
    expect(hasBinanceFillProof({})).toBe(false);
  });
});

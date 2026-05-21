import { analyzePositionHealth, computeSlProgress } from '../../src/analyzers/position-health.analyzer';

const base = {
  position_id: 'pos_test',
  symbol: 'BTC',
  side: 'long' as const,
  entry_price: 77828.7,
  current_price: 77816.9,
  stop_loss: 77350,
  take_profit: 78350,
  entry_time: new Date(Date.now() - 7 * 60 * 60 * 1000),
  size_qty: 0.0256,
  unrealized_pnl: 0,
};

describe('computeSlProgress', () => {
  it('is 0 at entry', () => {
    expect(computeSlProgress({ ...base, current_price: base.entry_price })).toBeCloseTo(0, 5);
  });

  it('is 1 at stop loss', () => {
    expect(computeSlProgress({ ...base, current_price: base.stop_loss })).toBeCloseTo(1, 5);
  });
});

describe('analyzePositionHealth', () => {
  it('holds at entry despite small absolute distance to SL', () => {
    const h = analyzePositionHealth({ ...base, current_price: base.entry_price });
    expect(h.recommended_action).toBe('hold');
  });

  it('does not repeat reduce after partial_closed', () => {
    const nearSl = { ...base, current_price: 77400 };
    const first = analyzePositionHealth(nearSl, { partial_closed: 0 });
    expect(first.recommended_action).toBe('reduce');

    const second = analyzePositionHealth(nearSl, { partial_closed: 0.5 });
    expect(second.recommended_action).toBe('hold');
  });

  it('exits when sl progress >= 90%', () => {
    const atSl = { ...base, current_price: 77380 };
    const h = analyzePositionHealth(atSl);
    expect(h.recommended_action).toBe('exit');
  });
});

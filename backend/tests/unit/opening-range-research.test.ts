import { describe, it, expect } from 'vitest';
import { openingRangeSignal } from '../../src/utils/opening-range-research';
import type { OpportunityCandle } from '../../src/utils/ai-opportunity';

const step = 900000, day = Date.UTC(2025, 0, 2);
function history(): OpportunityCandle[] {
  return Array.from({length: 25}, (_, i) => ({timestamp: day + (i - 20) * step,
    open: 100, high: 101, low: 99, close: 100, volume: 10}));
}
describe('preregistered UTC opening range', () => {
  it('requires a fully closed signal and ignores future candles', () => {
    const rows = history(); Object.assign(rows[24], {high: 103, close: 102, volume: 15});
    expect(openingRangeSignal(rows, day + 5 * step - 1, 'opening_range_breakout')).toBeNull();
    expect(openingRangeSignal(rows, day + 5 * step, 'opening_range_breakout')).toBe('long');
    rows.push({...rows[24], timestamp: day + 5 * step, low: 1, close: 2});
    expect(openingRangeSignal(rows, day + 5 * step, 'opening_range_breakout')).toBe('long');
  });
  it('uses prior volume only, supports shorts and rejects insufficient volume', () => {
    const rows = history(); Object.assign(rows[24], {low: 97, close: 98, volume: 14.99});
    expect(openingRangeSignal(rows, day + 5 * step, 'opening_range_breakout')).toBeNull();
    rows[24].volume = 15;
    expect(openingRangeSignal(rows, day + 5 * step, 'opening_range_breakout')).toBe('short');
  });
  it('consumes the first raw opportunity even when later admission would reject it', () => {
    const rows = history(); Object.assign(rows[24], {high: 103, close: 102, volume: 20});
    rows.push({...rows[0], timestamp: day + 5 * step}, {...rows[24], timestamp: day + 6 * step});
    expect(openingRangeSignal(rows, day + 7 * step, 'opening_range_breakout')).toBeNull();
  });
  it('rejects double sweeps and boundary closes for failed breakouts', () => {
    const rows = history(); rows[24].high = 102;
    expect(openingRangeSignal(rows, day + 5 * step, 'opening_range_failure')).toBe('short');
    rows[24].low = 98;
    expect(openingRangeSignal(rows, day + 5 * step, 'opening_range_failure')).toBeNull();
    rows[24].high = 101;
    expect(openingRangeSignal(rows, day + 5 * step, 'opening_range_failure')).toBe('long');
    rows[24].close = 99;
    expect(openingRangeSignal(rows, day + 5 * step, 'opening_range_failure')).toBeNull();
  });
  it('fails closed on gaps or missing day opening and expires at 06:00 UTC', () => {
    const rows = history(); rows[24].high = 102;
    expect(openingRangeSignal(rows.filter((_,i)=>i!==21), day + 5 * step, 'opening_range_failure')).toBeNull();
    expect(openingRangeSignal(rows.slice(21), day + 5 * step, 'opening_range_failure')).toBeNull();
    for(let i=5;i<=24;i++)rows.push({...rows[0],timestamp:day+i*step});
    rows.at(-1)!.low=98;
    expect(openingRangeSignal(rows, day + 25 * step, 'opening_range_failure')).toBeNull();
  });
});

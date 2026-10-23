import { describe, expect, it } from 'vitest';
import { PortfolioPaperEngine } from '../../src/portfolio/paper-engine';
import { buildCctPaperConfig } from '../../src/portfolio/policy-registry';
import { CCT_SOURCE_SYMBOLS } from '../../src/portfolio/source-cct';
import { CctRecordedParity, CCT_TESTBED_WINDOWS, processCctMinuteFrame } from '../../src/portfolio/cct-historical-replay';
import type { CctMinuteFrame } from '../../src/portfolio/cct-historical-replay';
import type { PortfolioPaperEvent, SourcePortfolioTargets } from '../../src/portfolio/types';

const DAY = 86_400_000, START = Date.UTC(2026, 5, 7, 17), UTC = START + 7 * 3_600_000;
const filters = Object.fromEntries(CCT_SOURCE_SYMBOLS.map(s => [s, { stepSize: '.01', minQty: '.01', minNotional: '1', maxQty: '10000' }]));
const bars = () => Object.fromEntries(CCT_SOURCE_SYMBOLS.map(s => [s, { open: '100', high: '100', low: '100', close: '100' }]));
const frame = (time: number): CctMinuteFrame => ({ openTimeMs: time, endTimeMs: time + 60000, mark: bars(), trade: bars(), funding: [] });
const target = (time: number): SourcePortfolioTargets => ({ strategy: 'cct-lc-b5-v1', sourceId: `cct:${time}`, knownAtMs: time, executeAtMs: time, labelTimeMs: time - DAY,
  weights: Object.fromEntries(CCT_SOURCE_SYMBOLS.map(s => [s, s === 'BTCUSDT' ? 1 : 0])), metadata: Object.fromEntries(CCT_SOURCE_SYMBOLS.map(s => [s, { signalCountChanged: true }])) });
describe('CCT exact-minute shared adapter', () => {
  it('settles opening funding before target, later funding at exact milliseconds, and final close only at END-1', () => {
    const engine = new PortfolioPaperEngine(buildCctPaperConfig(filters, { feeRate: '0', slippageBps: '0' }));
    processCctMinuteFrame(engine, frame(START));
    const events: PortfolioPaperEvent[] = [], next = frame(UTC);
    next.funding = [{ id: 'opening', symbol: 'BTCUSDT', time: UTC, rate: '.01', markPrice: '100' },
      { id: 'later13ms', symbol: 'BTCUSDT', time: UTC + 13, rate: '.01', markPrice: '100' }];
    processCctMinuteFrame(engine, next, { target: target(UTC), onTransition: result => events.push(...result.events) });
    expect(events.filter(e => e.kind === 'funding').map(e => [e.time, e.quantity, e.cashDelta])).toEqual([[UTC, '0', '0'], [UTC + 13, '1', '-1']]);
    expect(engine.observation().positions.BTCUSDT.quantity).toBe('1');
    processCctMinuteFrame(engine, frame(UTC + 60000), { final: true, onTransition: result => events.push(...result.events) });
    expect(events.find(e => e.reason === 'terminal_testbed_liquidation')?.time).toBe(UTC + 119999);
    expect(engine.observation().positions).toEqual({});
    expect(engine.summary().netPnl).toBe('-1');
  });
  it('rejects missing UTC targets, malformed candle ranges, and duplicate funding before modifying state', () => {
    const engine = new PortfolioPaperEngine(buildCctPaperConfig(filters)); const before = engine.snapshot();
    expect(() => processCctMinuteFrame(engine, frame(UTC))).toThrow('UTC CCT target');
    const bad = frame(START); bad.mark.BTCUSDT.high = '99';
    expect(() => processCctMinuteFrame(engine, bad)).toThrow('OHLC range');
    const funding = { id: 'duplicate', symbol: 'BTCUSDT', time: START, rate: '.01', markPrice: '100' };
    expect(() => processCctMinuteFrame(engine, { ...frame(START), funding: [funding, funding] })).toThrow('funding frame');
    expect(engine.snapshot()).toEqual(before);
  });
  it('counts one continuous128-day wallet including losing/cashdays without a split reset', () => {
    const engine = new PortfolioPaperEngine(buildCctPaperConfig(filters, { feeRate: '0', slippageBps: '0' }));
    const marks = Object.fromEntries(CCT_SOURCE_SYMBOLS.map(s => [s, '100']));
    for (let day = 0; day < 128; day++) engine.step({ id: `day:${day}`, time: CCT_TESTBED_WINDOWS.continuous128.startTimeMs + day * DAY, marks }, { snapshot: false });
    engine.step({ id: 'terminal', time: CCT_TESTBED_WINDOWS.continuous128.endTimeMs - 1, marks, forceClose: 'terminal' }, { snapshot: false });
    expect(engine.summary().calendarDays).toBe(128);
    expect(engine.summary().meanNetPerCalendarDay).toBe('0');
    expect(engine.snapshot().days).toHaveLength(127);
    expect(engine.snapshot().cash).toBe('100');
  });
  it('enforces declared money tolerance while quantities remain exact', () => {
    const parity = new CctRecordedParity('1e-20');
    parity.monetary('100.000000000000000000001', '100', 'rounding');
    expect(() => parity.monetary('1.000000000000000000001', '1', 'quantity', true)).toThrow('parity mismatch');
    expect(() => new CctRecordedParity('.01')).toThrow('broad');
  });
  it('counts finite equality fast paths and keeps the largest accepted monetary error', () => {
    const parity = new CctRecordedParity('1e-20');
    parity.monetary('100', '100', 'same-text');
    parity.monetary('0', '-0E-16', 'equal-decimal', true);
    parity.monetary('100.000000000000000000001', '100', 'larger-rounding');
    parity.monetary('100.0000000000000000000001', '100', 'smaller-rounding');
    parity.monetary('0.010', '.01', 'equal-quantity', true);
    expect(parity.moneyChecks).toBe(5);
    expect(parity.maximumError.toString()).toBe('1e-21');
    for (const invalid of ['NaN','Infinity','-Infinity']) expect(() => parity.monetary(invalid, invalid, 'invalid-same-text')).toThrow('parity mismatch');
    expect(() => parity.monetary('1', 'Infinity', 'invalid-expected')).toThrow('parity mismatch');
    expect(() => parity.monetary('1.0000000000000000000001', '1', 'exact-quantity', true)).toThrow('parity mismatch');
    expect(parity.moneyChecks).toBe(5);
    expect(parity.maximumError.toString()).toBe('1e-21');
  });
});

import { describe, it, expect } from 'vitest';
import type { TradeDecision } from '@prisma/client';
import {
  parseActionFromStoredReason,
  analysisFromStoredDecision,
  buildDispatchOutputFromStoredDecision,
} from '../../src/utils/llm-dispatch-dedup';

function makeRow(overrides: Partial<TradeDecision> = {}): TradeDecision {
  return {
    id: 42,
    symbol: 'BTC',
    timeframe: '1h',
    playbook_key: 'breakout',
    grade: 'A',
    confidence: 0.92,
    regime: 'trend',
    decision: 'trade',
    reason:
      'LLM confirmed trade · LLM: buy · conf 92% · entry 62,500 · SL 61,800 · TP 64,200',
    entry_price: 62500,
    stop_loss: 61800,
    take_profit: 64200,
    expected_rr: 2.4,
    timestamp: new Date('2026-07-13T10:00:00Z'),
    candle_hash: '1720861200000_63500_62400_62500',
    method_id: 'kim_nghia',
    ...overrides,
  };
}

describe('llm-dispatch-dedup', () => {
  it('parses buy/sell from stored reason', () => {
    expect(parseActionFromStoredReason('LLM: buy · conf 90%')).toBe('buy');
    expect(parseActionFromStoredReason('LLM: sell · conf 80%')).toBe('sell');
    expect(parseActionFromStoredReason('LLM: short · conf 80%')).toBe('sell');
    expect(parseActionFromStoredReason('LLM: long · conf 80%')).toBe('buy');
    expect(parseActionFromStoredReason('no action here')).toBeNull();
  });

  it('rebuilds trade analysis from stored row', () => {
    const row = makeRow();
    const analysis = analysisFromStoredDecision(row);
    expect(analysis?.action).toBe('buy');
    expect(analysis?.bias).toBe('bullish');
    expect(analysis?.confidence).toBe(0.92);
    expect(analysis?.suggested_entry).toBe(62500);
    expect(analysis?.suggested_stop_loss).toBe(61800);
    expect(analysis?.suggested_take_profit).toBe(64200);
  });

  it('returns no_trade for stored no_trade row', () => {
    const row = makeRow({
      decision: 'no_trade',
      entry_price: null,
      reason: 'LLM: hold · conf 40% · entry — · SL — · TP —',
    });
    const out = buildDispatchOutputFromStoredDecision(row);
    expect(out.decision).toBe('no_trade');
    expect(out.analysis).toBeUndefined();
    expect(out.decisionRecordId).toBe(42);
  });

  it('returns trade with execution-blocked reason for retry', () => {
    const row = makeRow({
      reason:
        'LLM confirmed trade · LLM: sell · conf 88% · entry 62,900 · SL 63,500 · TP 61,800 | Execution blocked: notional below min',
    });
    const out = buildDispatchOutputFromStoredDecision(row);
    expect(out.decision).toBe('trade');
    expect(out.analysis?.action).toBe('sell');
    expect(out.reason).toContain('Execution blocked');
    expect(out.decisionRecordId).toBe(42);
  });
});

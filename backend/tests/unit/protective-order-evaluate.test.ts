import { describe, it, expect } from 'vitest';
import {
  evaluateProtectiveAction,
  isPastStopLoss,
  isPastTakeProfit,
} from '../../src/services/protective-order.service';

describe('evaluateProtectiveAction', () => {
  const longBase = { side: 'long' as const, stop_loss: 61000, take_profit: 63000 };
  const shortBase = { side: 'short' as const, stop_loss: 63000, take_profit: 61000 };

  it('long past SL closes at market loss', () => {
    expect(evaluateProtectiveAction({ ...longBase, mark: 60500 })).toBe('close_at_market_loss');
  });

  it('long past TP closes at market profit', () => {
    expect(evaluateProtectiveAction({ ...longBase, mark: 63500 })).toBe('close_at_market_profit');
  });

  it('short past SL closes at market loss', () => {
    expect(evaluateProtectiveAction({ ...shortBase, mark: 63500 })).toBe('close_at_market_loss');
  });

  it('short past TP closes at market profit', () => {
    expect(evaluateProtectiveAction({ ...shortBase, mark: 60500 })).toBe('close_at_market_profit');
  });

  it('returns place_sl_tp when mark is between SL and TP', () => {
    expect(evaluateProtectiveAction({ ...longBase, mark: 62000 })).toBe('place_sl_tp');
    expect(evaluateProtectiveAction({ ...shortBase, mark: 62000 })).toBe('place_sl_tp');
  });

  it('returns place_sl_tp when mark is invalid', () => {
    expect(evaluateProtectiveAction({ ...longBase, mark: 0 })).toBe('place_sl_tp');
  });

  it('returns close when recomputed levels would be invalid for mark', () => {
    expect(
      evaluateProtectiveAction({
        side: 'long',
        stop_loss: 62500,
        take_profit: 63000,
        mark: 62000,
      })
    ).toBe('close_at_market_loss');
    expect(
      evaluateProtectiveAction({
        side: 'long',
        stop_loss: 61000,
        take_profit: 61500,
        mark: 62000,
      })
    ).toBe('close_at_market_profit');
  });

  it('prefers levels override over top-level SL/TP', () => {
    expect(
      evaluateProtectiveAction({
        side: 'long',
        stop_loss: 61000,
        take_profit: 63000,
        mark: 62000,
        levels: { stop_loss: 62500, take_profit: 63500 },
      })
    ).toBe('close_at_market_loss');
  });

  it('SL breach wins over TP when both are past', () => {
    expect(
      evaluateProtectiveAction({
        side: 'long',
        stop_loss: 62000,
        take_profit: 62000,
        mark: 62000,
      })
    ).toBe('close_at_market_loss');
  });
});

describe('isPastStopLoss', () => {
  it('long: mark at or below SL is past', () => {
    expect(isPastStopLoss('long', 61000, 61000)).toBe(true);
    expect(isPastStopLoss('long', 61000, 60500)).toBe(true);
  });

  it('long: mark above SL is not past', () => {
    expect(isPastStopLoss('long', 61000, 61500)).toBe(false);
  });

  it('short: mark at or above SL is past', () => {
    expect(isPastStopLoss('short', 63000, 63000)).toBe(true);
    expect(isPastStopLoss('short', 63000, 63500)).toBe(true);
  });

  it('short: mark below SL is not past', () => {
    expect(isPastStopLoss('short', 63000, 62500)).toBe(false);
  });

  it('invalid mark is never past SL', () => {
    expect(isPastStopLoss('long', 61000, 0)).toBe(false);
    expect(isPastStopLoss('long', 61000, Number.NaN)).toBe(false);
  });
});

describe('isPastTakeProfit', () => {
  it('long: mark at or above TP is past', () => {
    expect(isPastTakeProfit('long', 63000, 63000)).toBe(true);
    expect(isPastTakeProfit('long', 63000, 63500)).toBe(true);
  });

  it('long: mark below TP is not past', () => {
    expect(isPastTakeProfit('long', 63000, 62500)).toBe(false);
  });

  it('short: mark at or below TP is past', () => {
    expect(isPastTakeProfit('short', 61000, 61000)).toBe(true);
    expect(isPastTakeProfit('short', 61000, 60500)).toBe(true);
  });

  it('short: mark above TP is not past', () => {
    expect(isPastTakeProfit('short', 61000, 61500)).toBe(false);
  });

  it('invalid mark is never past TP', () => {
    expect(isPastTakeProfit('short', 61000, -1)).toBe(false);
    expect(isPastTakeProfit('short', 61000, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

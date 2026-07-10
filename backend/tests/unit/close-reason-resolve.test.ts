import { describe, expect, it } from 'vitest';
import { resolveVerifiedCloseReason } from '../../src/services/close-reason-resolve.service';

describe('resolveVerifiedCloseReason', () => {
  it('maps order_type TAKE_PROFIT to binance_tp', () => {
    expect(
      resolveVerifiedCloseReason('reconciliation_fill', { order_type: 'TAKE_PROFIT_MARKET' })
    ).toBe('binance_tp');
  });

  it('maps order_type STOP to binance_sl', () => {
    expect(resolveVerifiedCloseReason('account_update_zero_position', { order_type: 'STOP_MARKET' })).toBe(
      'binance_sl'
    );
  });

  it('maps sl order id match', () => {
    expect(
      resolveVerifiedCloseReason(
        'reconciliation_fill',
        { binance_order_id: '99' },
        { binance_sl_order_id: '99', binance_tp_order_id: '100' }
      )
    ).toBe('binance_sl');
  });

  it('keeps explicit take_profit as binance_tp', () => {
    expect(resolveVerifiedCloseReason('take_profit', {})).toBe('binance_tp');
  });
});

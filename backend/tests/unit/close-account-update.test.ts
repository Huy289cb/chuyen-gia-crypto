import { describe, it, expect } from 'vitest';
import { buildCloseAccountUpdate as build, shouldUpdateClosedAccount as eligible } from '../../src/utils/close-account-update';
const time = new Date('2026-10-02T12:45:00Z');
describe('shared close account bookkeeping', () => {
  it('increments net realized pnl and loss streak on verified loss', () => {
    expect(build({balance:30,realizedPnl:-1,lastTradeTime:time,updatedAt:time})).toEqual({current_balance:29,equity:29,unrealized_pnl:0,
      realized_pnl:{increment:-1},total_trades:{increment:1},winning_trades:{increment:0},losing_trades:{increment:1},consecutive_losses:{increment:1},last_trade_time:time,updated_at:time});
  });
  it('preserves existing breakeven threshold without calling omitted pnl economic zero', () => {
    for(const realizedPnl of [-.01,0,.01]){
      const data=build({balance:30,realizedPnl,lastTradeTime:time,updatedAt:time});
      expect(data.current_balance).toBeUndefined();expect(data.realized_pnl).toBeUndefined();expect(data.consecutive_losses).toBe(0);expect(data.total_trades.increment).toBe(1);
    }
    expect(build({balance:30,realizedPnl:.010001,lastTradeTime:time,updatedAt:time}).current_balance).toBe(30.010001);
  });
  it('does not update economic statistics for bookkeeping or unverified exchange close', () => {
    expect(eligible(true,true,true)).toBe(false);expect(eligible(false,false,true)).toBe(false);
    expect(eligible(false,true,true)).toBe(true);expect(eligible(false,false,false)).toBe(true);
  });
});
it('keeps wallet authoritative when partial proceeds were already synced',()=>{
 const update=build({balance:34.95,realizedPnl:14.8,lastTradeTime:time,updatedAt:time,walletAuthoritative:true});
 expect(update.current_balance).toBeUndefined();expect(update.equity).toBeUndefined();expect(update.realized_pnl).toEqual({increment:14.8});expect(update.total_trades).toEqual({increment:1});
 expect(build({balance:34.95,realizedPnl:14.8,lastTradeTime:time,updatedAt:time}).current_balance).toBe(49.75);
});

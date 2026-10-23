import {it,expect} from 'vitest';import {replayRecordedAccountState as replay} from '../../src/utils/recorded-account-state';
const now=Date.parse('2026-10-02T14:20:00Z');const snapshot=()=>({schema:'prospective-account-state-v1',source:'SELECT_only_repeatable_read',read_started_at:new Date(now-10).toISOString(),known_at:new Date(now).toISOString(),account:{id:1,symbol:'BTC',method_id:'kim_nghia',starting_balance:30,current_balance:29,equity:29,unrealized_pnl:0,realized_pnl:-1,max_drawdown:1,accumulated_trading_fees:.1,accumulated_funding_fee:0,total_trades:1,winning_trades:0,losing_trades:1,consecutive_losses:1,precision_error_count:0,last_trade_time:null as string|null,cooldown_until:null as string|null,precision_cooldown_until:null,updated_at:new Date(now-100).toISOString()},positions:[],pending:[]});
it('allows only prospective seeding and does not invent economic capital or exchange inventory',()=>{expect(replay(snapshot(),now)).toMatchObject({status:'observed',economic_initial_capital:null,seed_not_before:new Date(now).toISOString()});expect(replay(snapshot(),now-1).status).toBe('unknown');});
it('rejects missing fields and contradictory state clocks',()=>{const d=snapshot();delete (d.account as Partial<typeof d.account>).current_balance;expect(replay(d,now).status).toBe('unknown');const future=snapshot();future.account.updated_at=new Date(now+1).toISOString();expect(replay(future,now).status).toBe('unknown');});
it('rejects future trade history while permitting future cooldown deadlines',()=>{
 const d=snapshot();d.account.last_trade_time=new Date(now+1).toISOString();expect(replay(d,now)).toMatchObject({status:'unknown',reason:'future_recorded_trade_time'});
 const cooldown=snapshot();cooldown.account.cooldown_until=new Date(now+10000).toISOString();expect(replay(cooldown,now).status).toBe('observed');
});

it('accepts production signed short quantities without normalizing stored state',()=>{
 const position={position_id:'short',status:'open',side:'short',size_qty:-2,entry_price:100,risk_usd:1,entry_time:new Date(now-100).toISOString()};
 for(const qty of [-2,2]){const d={...snapshot(),positions:[{...position,size_qty:qty}]};expect(replay(d,now)).toMatchObject({status:'observed',local_inventory:{positions:[{size_qty:qty}]}});}
 for(const qty of [0,NaN,Infinity])expect(replay({...snapshot(),positions:[{...position,size_qty:qty}]},now).status).toBe('unknown');
 expect(replay({...snapshot(),positions:[{...position,side:'long'}]},now).status).toBe('unknown');
});

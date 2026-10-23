const obj=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const time=(v:unknown)=>typeof v==='string'?Date.parse(v):NaN;
/** Snapshot may seed future replay; never seed events known before its observation. */
export function replayRecordedAccountState(record:unknown,asOf:number){
 const unknown=(reason:string)=>({status:'unknown' as const,reason});
 const d=obj(record),account=obj(d?.account);
 if(d?.schema!=='prospective-account-state-v1'||d.source!=='SELECT_only_repeatable_read'||!account||!Number.isFinite(asOf))return unknown('missing_account_snapshot');
 const started=time(d.read_started_at),known=time(d.known_at),updated=time(account.updated_at);
 if(![started,known,updated].every(Number.isFinite)||started>known||updated>known||known>asOf)return unknown('invalid_snapshot_cutoff');
 const numeric=['starting_balance','current_balance','equity','unrealized_pnl','realized_pnl','max_drawdown','accumulated_trading_fees','accumulated_funding_fee'];
 const counts=['total_trades','winning_trades','losing_trades','consecutive_losses','precision_error_count'];
 if(!Number.isSafeInteger(account.id)||Number(account.id)<=0||account.symbol!=='BTC'||account.method_id!=='kim_nghia'||!numeric.every(k=>Number.isFinite(account[k]))||!counts.every(k=>Number.isSafeInteger(account[k])&&Number(account[k])>=0)||!['last_trade_time','cooldown_until','precision_cooldown_until'].every(k=>account[k]===null||Number.isFinite(time(account[k]))))return unknown('invalid_account_fields');
 if(account.last_trade_time!==null&&time(account.last_trade_time)>known)return unknown('future_recorded_trade_time');
 if(!Array.isArray(d.positions)||!Array.isArray(d.pending))return unknown('missing_inventory_snapshot');
 const positions=new Set<string>(),pending=new Set<string>();
 for(const value of d.positions){const p=obj(value);if(!p||typeof p.position_id!=='string'||!p.position_id||positions.has(p.position_id)||!['open','reconciliation_failed_not_on_binance'].includes(String(p.status))||!['long','short'].includes(String(p.side))||![p.size_qty,p.entry_price,p.risk_usd].every(Number.isFinite)||Number(p.size_qty)===0||(p.side==='long'&&Number(p.size_qty)<0)||Number(p.entry_price)<=0||Number(p.risk_usd)<0||!Number.isFinite(time(p.entry_time))||time(p.entry_time)>known)return unknown('invalid_position_inventory');positions.add(p.position_id);}
 for(const value of d.pending){const p=obj(value);if(!p||typeof p.order_id!=='string'||!p.order_id||pending.has(p.order_id)||!['pending','partially_filled','reconciliation_failed_not_on_binance'].includes(String(p.status)))return unknown('invalid_pending_inventory');pending.add(p.order_id);}
 return {status:'observed' as const,account_id:account.id,seed_not_before:new Date(known).toISOString(),local_account_state:account,local_inventory:{positions:d.positions,pending:d.pending},economic_initial_capital:null,exchange_inventory_verification:'not_established' as const,mutation_coverage:'not_established' as const};
}

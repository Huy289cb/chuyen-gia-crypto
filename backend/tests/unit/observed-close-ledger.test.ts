import {it,expect} from 'vitest';import {buildObservedCloseLedger as ledger} from '../../src/utils/observed-close-ledger';import {buildCloseAccountUpdate} from '../../src/utils/close-account-update';
const t=Date.now(),iso=(n:number)=>new Date(t+n).toISOString();
function events(){const common={schema:'position-close-write-v1',clock_source:'application_write_return',close_attempt_id:'c',account_id:1,position_id:'p',fill_verified:true,bookkeeping:false,outcome:'returned'};const u=buildCloseAccountUpdate({balance:30,realizedPnl:1,lastTradeTime:new Date(t+5),updatedAt:new Date(t+6)});return [{id:1,timestamp:iso(2),event_type:'position_close_write_observed',event_data:{...common,kind:'close_status',write_started_at:iso(1),write_returned_at:iso(2),input:{position_id:'p',close_price:110,close_reason:'tp'}}},{id:2,timestamp:iso(4),event_type:'position_close_write_observed',event_data:{...common,kind:'close_financial_update',write_started_at:iso(3),write_returned_at:iso(4),input:{current_price:110,realized_pnl:1,entry_fee:.1,exit_fee:.1,funding_fee:.01,unrealized_pnl:0}}},{id:3,position_id:'p',timestamp:iso(8),event_type:'close_account_update_applied',event_data:{schema:'close-account-update-v1',account_id:1,applied_clock_source:'db_update_return',applied_at:iso(7),input:{balance:30,realized_pnl:1,bookkeeping:false,fill_verified:true,binance_enabled:false,last_trade_time:iso(5),updated_at:iso(6)},update:{...u,last_trade_time:iso(5),updated_at:iso(6)}}}];}
it('joins net close and account contract without double subtracting fees',()=>{expect(ledger(events(),t+10)).toMatchObject({observed_net_close_subtotal:1,unknown_rows:0,economic_roi_base:null,rows:[{net_pnl:1,entry_fee:.1,fee_basis:'already_in_verified_round_net_pnl'}]});});
it('withholds missing account or duplicate financial applications',()=>{expect(ledger(events().slice(0,2),t+10).observed_net_close_subtotal).toBeNull();const x=events();x.push({...x[1],id:4});expect(ledger(x,t+10).observed_net_close_subtotal).toBeNull();});
it('withholds unverified fills and inconsistent account value',()=>{const x=events();x[1].event_data.fill_verified=false;expect(ledger(x,t+10).observed_net_close_subtotal).toBeNull();const y=events();y[2].event_data.input.realized_pnl=2;expect(ledger(y,t+10).observed_net_close_subtotal).toBeNull();});
function round(){return {id:9,position_id:'p',timestamp:iso(3),event_type:'close_round_query_observed',event_data:{schema:'close-round-query-v1',input:{symbol:'BTCUSDT',side:'long',entry_order_id:'100',size_qty:1,window_start:t,window_end:t+2},observations:{received_at:iso(3),source:'binance_window_queries',fills_complete:true,income_complete:true,fills:[{tradeId:1,orderId:100,side:'BUY',price:100,qty:1,commission:.1,commissionAsset:'USDT',realizedPnl:0,time:t},{tradeId:2,orderId:101,side:'SELL',price:101.21,qty:1,commission:.1,commissionAsset:'USDT',realizedPnl:1.21,time:t+2}],income:[{incomeType:'FUNDING_FEE',income:'-0.01',time:t+1,asset:'USDT',tranId:1}]}}};}
it('matches actual shared round reconstruction and rejects revised values',()=>{const x=[...events(),round()];expect(ledger(x,t+10).round_reconciliation[0]).toMatchObject({status:'observed_round_matches_close_contract',trade_ids:['1','2']});const y=round();y.event_data.observations.fills[1].realizedPnl=2;expect(ledger([...events(),y],t+10).round_reconciliation[0]).toMatchObject({status:'unknown',reason:'round_financial_values_conflict'});});
it('reports reused exchange trade identities and missing rounds',()=>{expect(ledger(events(),t+10).round_reconciliation[0]).toMatchObject({reason:'missing_or_ambiguous_round_query'});const other={...round(),id:10,position_id:'other'};expect(ledger([...events(),round(),other],t+10).round_reconciliation[0]).toMatchObject({reason:'exchange_fill_identity_reused_across_positions'});});
it('separates full round net from period cashflows across opening fills and funding',()=>{
 const x=[...events(),round()];
 expect(ledger(x,t+10,t-1).period_cashflows.observed_subtotal).toBeCloseTo(1);
 const startAtEntry=ledger(x,t+10,t);expect(startAtEntry.observed_net_close_subtotal).toBe(1);expect(startAtEntry.period_cashflows.observed_subtotal).toBeCloseTo(1.1);
 expect(startAtEntry.period_cashflows.rows[0]).toMatchObject({trade_ids:['2'],funding_ids:['1'],trading_fees:.1,round_crosses_period_start:true});
 expect(ledger(x,t+10,t+1).period_cashflows.observed_subtotal).toBeCloseTo(1.11);
 expect(ledger(x,t+10,t+2).period_cashflows.observed_subtotal).toBe(0);
 expect(startAtEntry.economic_roi_base).toBeNull();expect(startAtEntry.period_cashflows.portfolio_cashflow_coverage).toBe('not_established');
});
it('withholds period totals without a valid boundary or round reconciliation',()=>{
 for(const start of [undefined,NaN,t+11])expect(ledger([...events(),round()],t+10,start).period_cashflows.observed_subtotal).toBeNull();
 expect(ledger(events(),t+10,t).period_cashflows.observed_subtotal).toBeNull();
});
it('rejects reused funding even when two rounds have distinct fill IDs',()=>{
 const other=round();other.id=10;other.position_id='other';other.event_data.observations.fills.forEach(f=>f.tradeId+=10);
 const result=ledger([...events(),round(),other],t+10,t-1);
 expect(result.round_reconciliation[0]).toMatchObject({status:'unknown',reason:'funding_identity_reused_across_positions'});expect(result.period_cashflows.observed_subtotal).toBeNull();
});

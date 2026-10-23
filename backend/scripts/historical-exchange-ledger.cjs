'use strict';
// Read boundary for a newly initialized simulated account. Execution adds actual modeled fills.
function createHistoricalExchangeLedger({seedAt,readClock,initialFills=[],initialIncome=[]}){
 if(!Number.isFinite(seedAt)||typeof readClock!=='function'||initialFills.length||initialIncome.length)throw Error('fresh_flat_simulated_account_required');
 const fills=[],income=[],reads=[];const fillIds=new Set(),incomeIds=new Set();
 function now(){const at=readClock();if(!Number.isFinite(at)||at<seedAt)throw Error('invalid_exchange_ledger_clock');return at;}
 function symbol(s){const pair=String(s).toUpperCase();if(!['BTC','BTCUSDT'].includes(pair))throw Error('ledger_symbol_not_supported');return 'BTCUSDT';}
 function appendFill(fill){
  symbol(fill.symbol??'BTC');if(fill.tradeId==null||fill.orderId==null||fillIds.has(String(fill.tradeId))||![fill.time,fill.price,fill.qty,fill.commission,fill.realizedPnl].every(Number.isFinite)||fill.time<seedAt||fill.time>now()||fill.qty<=0||fill.price<=0||fill.commission<0||!['BUY','SELL'].includes(fill.side)||fill.commissionAsset!=='USDT')throw Error('invalid_or_duplicate_modeled_fill');
  fillIds.add(String(fill.tradeId));fills.push({...fill,symbol:'BTCUSDT'});
 }
 function appendIncome(row){symbol(row.symbol??'BTC');if(row.tranId==null||incomeIds.has(String(row.tranId))||row.asset!=='USDT'||row.incomeType!=='FUNDING_FEE'||!Number.isFinite(Number(row.income))||!Number.isFinite(row.time)||row.time<seedAt||row.time>now())throw Error('invalid_or_duplicate_modeled_income');incomeIds.add(String(row.tranId));income.push({...row,symbol:'BTCUSDT'});}
 function query(rows,s,options={}){symbol(s);const at=now(),start=options.startTime??seedAt,end=options.endTime??at,limit=options.limit??1000;if(!Number.isFinite(start)||!Number.isFinite(end)||start>end||end>at||!Number.isInteger(limit)||limit<1)throw Error('invalid_ledger_read_window');const found=rows.filter(r=>r.time>=start&&r.time<=end).sort((a,b)=>a.time-b.time).slice(0,limit).map(r=>({...r}));reads.push({at,start,end,returned:found.length,kind:rows===fills?'fills':'income'});return found;}
 return {appendFill,appendIncome,tradingAdapter:{getUserTrades:async(s,o)=>query(fills,s,o)},incomeAdapter:{fetchBinanceIncomeRows:async(o={})=>query(income,o.symbol??'BTC',o)},diagnostics:()=>({seed_at:seedAt,initial_state:'new_simulated_account_flat_no_prior_trades',fills:fills.map(f=>({...f})),income:income.map(r=>({...r})),reads:reads.map(r=>({...r})),economic_roi:null})};
}
module.exports={createHistoricalExchangeLedger};

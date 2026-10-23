'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const decimal=v=>typeof v==='string'&&/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(v)&&Number.isFinite(Number(v));
async function collectExchangeCashflows(get,endpoints,since,through,clock=()=>Date.now()){
 const start=Date.parse(since),end=Date.parse(through),requested=clock();
 if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end||end>requested||end-start>31*86400000||start<requested-80*86400000)throw Error('invalid_bounded_window');
 const rows=new Map(),pages=[];let finished=false;
 for(let page=1;page<=20;page++){
  const began=clock(),batch=await get(endpoints.INCOME,{startTime:String(start),endTime:String(end),page:String(page),limit:'1000'},true),received=clock(),prior=rows.size;
  if(!Array.isArray(batch)||batch.length>1000)throw Error('invalid_income_page');
  for(const raw of batch){
   if(!raw||typeof raw.incomeType!=='string'||!raw.incomeType||typeof raw.asset!=='string'||!raw.asset||!decimal(raw.income)||!Number.isSafeInteger(raw.time)||raw.time<start||raw.time>end||!(typeof raw.tranId==='string'&&/^\d+$/.test(raw.tranId)||Number.isSafeInteger(raw.tranId)&&raw.tranId>=0))throw Error('invalid_income_row');
   const row={incomeType:raw.incomeType,asset:raw.asset,income:raw.income,time:raw.time,tranId:String(raw.tranId),symbol:typeof raw.symbol==='string'?raw.symbol:null},key=row.incomeType+':'+row.tranId;
   if(rows.has(key)&&JSON.stringify(rows.get(key))!==JSON.stringify(row))throw Error('conflicting_income_identity');
   rows.set(key,row);
  }
  pages.push({page,requested_at:new Date(began).toISOString(),received_at:new Date(received).toISOString(),rows:batch.length});
  if(batch.length<1000){finished=true;break;}
  if(rows.size===prior)throw Error('income_pagination_no_progress');
 }
 if(!finished)throw Error('income_page_limit');
 const accountRequested=clock(),raw=await get(endpoints.ACCOUNT,{},true),accountReceived=clock();
 if(!raw||!Array.isArray(raw.assets)||!Array.isArray(raw.positions))throw Error('invalid_account_snapshot');
 const assets=raw.assets.map(a=>{if(typeof a.asset!=='string'||![a.walletBalance,a.unrealizedProfit,a.marginBalance].every(decimal))throw Error('invalid_account_asset');return {asset:a.asset,walletBalance:a.walletBalance,unrealizedProfit:a.unrealizedProfit,marginBalance:a.marginBalance};});
 if(new Set(assets.map(a=>a.asset)).size!==assets.length)throw Error('duplicate_account_asset');
 const positions=raw.positions.map(p=>{if(typeof p.symbol!=='string'||!decimal(p.positionAmt)||!decimal(p.unrealizedProfit))throw Error('invalid_account_position');return {symbol:p.symbol,positionSide:p.positionSide??null,positionAmt:p.positionAmt,unrealizedProfit:p.unrealizedProfit};});
 const income=[...rows.values()].sort((a,b)=>a.time-b.time||a.tranId.localeCompare(b.tranId)),period=income.filter(r=>r.time>start);
 const observedByAssetAndType={};for(const r of period){const key=r.asset+':'+r.incomeType;observedByAssetAndType[key]=(observedByAssetAndType[key]??0)+Number(r.income);if(!Number.isFinite(observedByAssetAndType[key]))throw Error('nonfinite_income_sum');}
 return {schema:'exchange-cashflow-export-v1',since:new Date(start).toISOString(),through:new Date(end).toISOString(),source:'running_worker_signed_GET',query_scope:'all_symbols_all_income_types_all_returned_assets',income_endpoint:endpoints.INCOME,pages,endpoint_pagination_finished:true,income,period_basis:'open_left_closed_right',observed_by_asset_and_type:observedByAssetAndType,account_snapshot:{endpoint:endpoints.ACCOUNT,requested_at:new Date(accountRequested).toISOString(),received_at:new Date(accountReceived).toISOString(),multiAssetsMargin:typeof raw.multiAssetsMargin==='boolean'?raw.multiAssetsMargin:null,assets,positions,terminal_equity_at_requested_cutoff:'not_established'},capital_flow_coverage:'not_established',wallet_flow_reconciliation:'not_established',economic_roi:null,limits:'Endpoint response pagination only, not independent retention/completeness proof. Account snapshot is observed after the requested window, not historical cutoff equity. No transfer inference from local starting_balance/reset; non-USDT amounts remain unconverted.'};
}
module.exports={collectExchangeCashflows};
if(require.main===module){
 const [since,through,out]=process.argv.slice(2);if(!out||fs.existsSync(out))throw Error('SINCE CUTOFF NEW_OUTPUT');
 const cp=require('node:child_process'),apps=JSON.parse(cp.execFileSync('pm2',['jlist'],{encoding:'utf8'})),worker=apps.find(a=>a.name==='crypto-worker');if(!worker?.pid||worker.pm2_env.status!=='online')throw Error('worker_not_online');
 Object.assign(process.env,Object.fromEntries(fs.readFileSync('/proc/'+worker.pid+'/environ','utf8').split('\0').filter(Boolean).map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)];})));
 const {get}=require('../dist/services/binance/client'),{endpoints}=require('../dist/services/binance/endpoints');
 collectExchangeCashflows(get,endpoints,since,through).then(report=>{report.collector_sha256=crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');fs.writeFileSync(path.resolve(out),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify({income_rows:report.income.length,pages:report.pages.length,economic_roi:null}));}).catch(e=>{console.error('exchange_cashflow_capture_failed:'+(['invalid_bounded_window','income_page_limit','income_pagination_no_progress'].includes(e.message)?e.message:'unverified_response'));process.exitCode=1;});
}

// GET-only verification of exact fill IDs recorded in close events; no schedulers or execution.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const[inputFile,outFile]=process.argv.slice(2);if(!inputFile||!outFile||fs.existsSync(outFile))throw Error('Usage: EXPORT NEW_OUTPUT');
const bytes=fs.readFileSync(inputFile),input=JSON.parse(bytes);
const apps=JSON.parse(cp.execFileSync('pm2',['jlist'],{encoding:'utf8'}));const worker=apps.find(a=>a.name==='crypto-worker');
if(!worker?.pid||worker.pm2_env.status!=='online')throw Error('worker_not_online');
Object.assign(process.env,Object.fromEntries(fs.readFileSync('/proc/'+worker.pid+'/environ','utf8').split('\0').filter(Boolean).map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)];})));
const{get}=require('../dist/services/binance/client');const rows=[];
(async()=>{
 for(const position of input.positions){
  const close=input.events.find(e=>e.position_id===position.position_id&&e.event_type==='position_closed');
  const wanted=close?.event_data?.binance_fill_ids;
  if(!Array.isArray(wanted)||!wanted.length||wanted.some(id=>!Number.isSafeInteger(Number(id))||Number(id)<=0)){
   rows.push({positionId:position.position_id,status:'unknown',reason:'recorded_fill_ids_missing'});continue;
  }
  let response;try{response=await get('/fapi/v1/userTrades',{symbol:'BTCUSDT',fromId:Math.min(...wanted.map(Number)),limit:1000},true);}catch{
   rows.push({positionId:position.position_id,status:'unknown',reason:'exchange_query_failed'});continue;
  }
  if(!Array.isArray(response)){rows.push({positionId:position.position_id,status:'unknown',reason:'invalid_exchange_response'});continue;}
  const matched=response.filter(t=>wanted.some(id=>String(id)===String(t.id))).map(t=>({id:t.id,orderId:t.orderId,symbol:t.symbol,side:t.side,
   price:Number(t.price),qty:Number(t.qty),commission:Number(t.commission),commissionAsset:t.commissionAsset,realizedPnl:Number(t.realizedPnl),time:t.time}));
  const missing=wanted.filter(id=>!matched.some(t=>String(t.id)===String(id)));
  const invalid=matched.some(t=>t.symbol!=='BTCUSDT'||t.commissionAsset!=='USDT'||![t.qty,t.price,t.commission,t.realizedPnl].every(Number.isFinite));
  const entry=matched.filter(t=>String(t.orderId)===String(position.binance_order_id));
  const exit=matched.filter(t=>t.side===(position.side==='long'?'SELL':'BUY'));
  const sum=(list,key)=>list.reduce((n,t)=>n+t[key],0);
  const qty=sum(exit,'qty'),gross=sum(matched,'realizedPnl'),entryFee=sum(entry,'commission'),exitFee=sum(exit,'commission');
  const delta={entryFee:entryFee-position.entry_fee,exitFee:exitFee-position.exit_fee,
   netUsingDbFunding:gross-entryFee-exitFee-position.funding_fee-position.realized_pnl,
   closeQty:qty-position.size_qty};
  const complete=!missing.length&&!invalid&&entry.length>0&&exit.length>0;
  const equal=Object.values(delta).every(v=>Number.isFinite(v)&&Math.abs(v)<1e-7);
  rows.push({positionId:position.position_id,status:complete?(equal?'matched_component':'mismatch'):'unknown',missingFillIds:missing,
   fills:matched,grossPnl:gross,entryFee,exitFee,closeQty:qty,delta,fundingStatus:'db_only_unverified',
   storedCloseDelayMs:exit.length?Date.parse(position.close_time)-Math.max(...exit.map(t=>t.time)):null});
 }
 const result={schema:'recorded-fill-ledger-v1',capturedAt:new Date().toISOString(),inputSha256:crypto.createHash('sha256').update(bytes).digest('hex'),
  exchangeAccess:'GET only, worker environment',rows,fullParity:'unknown',roiStatus:'unproved',
  limitations:['Exact recorded fill IDs only: not proof no additional fills exist.','Funding remains DB-only; no account income ledger queried.',
   'Matching trade economics does not replay admission, protection, exit/cancel timing or initial account state.']};
 fs.writeFileSync(path.resolve(outFile),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({rows:rows.length,statuses:rows.map(r=>r.status),fullParity:result.fullParity}));
})().catch(()=>{console.error('fill_ledger_capture_failed');process.exitCode=1;});

// Read-only raw state. Never invokes mutating circuit/admission services or resets history.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const out=process.argv[2];if(!out||fs.existsSync(out))throw Error('new_output_required');
const app=JSON.parse(cp.execFileSync('pm2',['jlist'],{encoding:'utf8'})).find(a=>a.name==='crypto-worker');
if(!app?.pid)throw Error('worker_unavailable');
const envBytes=fs.readFileSync('/proc/'+app.pid+'/environ','utf8');
Object.assign(process.env,Object.fromEntries(envBytes.split('\0').filter(Boolean).map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)];})));
const build=path.dirname(app.pm2_env.pm_exec_path),{prisma}=require(path.join(build,'lib/prisma'));
const policy=require(path.join(build,'config/risk-policy')).getRiskPolicy();
const rollup=require(path.join(build,'services/expectancy-rollup.service')).rollupExpectancyFromOutcomes;
const entryPolicy=require(path.join(build,'config/pending-order-policy'));
const {get}=require(path.join(build,'services/binance/client'));
const {getBinanceLossStreak}=require(path.join(build,'services/binance-trade-history.service'));
const {resolveLossCooldownUntil}=require(path.join(build,'config/risk-policy'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 const result=await prisma.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const timeRows=await tx.$queryRawUnsafe('SELECT transaction_timestamp() AS now');
  const asOf=timeRows[0].now,dayStart=new Date(Math.floor((+asOf+7*3600000)/86400000)*86400000-7*3600000);
  const account=await tx.testnetAccount.findFirst({where:{symbol:'BTC',method_id:'kim_nghia'},select:{id:true,current_balance:true,equity:true,starting_balance:true,cooldown_until:true,consecutive_losses:true,max_drawdown:true}});
  if(!account)throw Error('account_missing');
  const since=policy.circuitExpectancySince;
  const [dailyBaseline,epochBaseline,peak,outcomes,openPositions,pendingOrders,recentClose,cancels]=await Promise.all([
   tx.testnetAccountSnapshot.findFirst({where:{account_id:account.id,timestamp:{lt:dayStart}},orderBy:{timestamp:'desc'},select:{timestamp:true,equity:true}}),
   since?tx.testnetAccountSnapshot.findFirst({where:{account_id:account.id,timestamp:{lt:since}},orderBy:{timestamp:'desc'},select:{timestamp:true,equity:true}}):null,
   tx.testnetAccountSnapshot.aggregate({where:{account_id:account.id,...(since?{timestamp:{gte:since}}:{})},_max:{equity:true}}),
   tx.tradeOutcome.findMany({where:since?{timestamp:{gte:since}}:undefined,orderBy:{timestamp:'desc'},take:policy.circuitExpectancyWindow,select:{timestamp:true,realized_rr:true,realized_pnl:true}}),
   tx.testnetPosition.count({where:{symbol:'BTC',status:{in:['open','reconciliation_failed_not_on_binance']}}}),
   tx.testnetPendingOrder.count({where:{symbol:'BTC',status:{in:['pending','partially_filled','reconciliation_failed_not_on_binance']}}}),
   tx.testnetPosition.findFirst({where:{symbol:'BTC',status:'closed',close_time:{not:null,lte:asOf},account:{method_id:'kim_nghia'}},orderBy:{close_time:'desc'},select:{close_time:true,realized_pnl:true,side:true}}),
   tx.testnetTradeEvent.findMany({where:{position_id:'pipeline_v3_kim_nghia',event_type:'pending_order_cancelled',timestamp:{gte:new Date(+asOf-entryPolicy.getPendingOrderReentryCooldownMinutes()*60000)}},orderBy:{timestamp:'desc'},take:20,select:{timestamp:true,event_data:true}}),
  ]);
  const cancelTimes=cancels.filter(e=>{try{const d=JSON.parse(e.event_data);return !d?.symbol||String(d.symbol).toUpperCase().replace(/USDT$/,'')==='BTC';}catch{return true;}}).map(e=>+e.timestamp);
  const cooldownInputs={accountUntil:account.cooldown_until?+account.cooldown_until:0,
   postCloseUntil:recentClose?.close_time?+recentClose.close_time+entryPolicy.getPostCloseSameSideCooldownMinutes((recentClose.realized_pnl??0)<-.01)*60000:0,
   cancelUntil:cancelTimes.length?Math.max(...cancelTimes)+entryPolicy.getPendingOrderReentryCooldownMinutes()*60000:0};
  return {asOf,dayStart,account,dailyBaseline,epochBaseline,snapshotPeak:peak._max.equity,outcomes,
   expectancy:rollup(outcomes),openPositions,pendingOrders,recentClose,cooldownInputs,
   observedDatabaseBlockedUntil:Math.max(...Object.values(cooldownInputs))};
 },{isolationLevel:'RepeatableRead',timeout:30000});
 const exchange={};
 for(const [name,endpoint]of [['positions','/fapi/v2/positionRisk'],['orders','/fapi/v1/openOrders'],['algoOrders','/fapi/v1/openAlgoOrders']]){
  const startedAt=new Date().toISOString();
  try{const raw=await get(endpoint,{symbol:'BTCUSDT'},true),rows=Array.isArray(raw)?raw:raw?.orders;
   if(!Array.isArray(rows))throw Error('invalid_response');
   exchange[name]={status:'known',startedAt,receivedAt:new Date().toISOString(),count:name==='positions'?rows.filter(r=>r.symbol==='BTCUSDT'&&Number(r.positionAmt)!==0).length:rows.length};
  }catch{exchange[name]={status:'unknown',startedAt,receivedAt:new Date().toISOString()};}
 }
 const selectedPolicy=Object.fromEntries(['circuitExpectancySince','circuitPeakEquityOverride','circuitExpectancyWindow','circuitExpectancyMinSumR','circuitExpectancyKillEnabled','circuitDrawdownEnabled','maxDrawdownPercent','circuitDailyLossEnabled','dailyLossLimitPercent'].map(k=>[k,policy[k]]));
 let lossStreak={status:'unknown'};
 if(process.env.BINANCE_ENABLED==='true')try{
  const startedAt=new Date().toISOString(),streak=await getBinanceLossStreak('BTC');
  const until=streak.lastLossTime>0?resolveLossCooldownUntil(streak.consecutiveLosses,new Date(streak.lastLossTime)):null;
  lossStreak={status:'known',startedAt,receivedAt:new Date().toISOString(),...streak,blockedUntil:until?.getTime()??0};
 }catch{ /* Unknown is not a zero-loss streak. */ }
 const r={schema:'initial-account-evidence-v3',...result,exchange,lossStreak,policy:selectedPolicy,
  codeHashes:Object.fromEntries(['services/account-circuit.service.js','services/account-risk-guard.service.js','services/v3-entry-eligibility.service.js','config/risk-policy.js'].map(f=>[f,sha(fs.readFileSync(path.join(build,f)))])),
  scriptSha256:sha(fs.readFileSync(__filename)),
  runtimeEnvUnchanged:fs.readFileSync('/proc/'+app.pid+'/environ','utf8')===envBytes,
  readyForReplay:false,missing:['Worker-local protective exposure block is not observable from a separate process',...(lossStreak.status==='known'?[]:['Exchange loss-streak cooldown not independently reconciled']),'Exact live circuit semantics verification; raw snapshot is not order permission'],
  consistency:'DB repeatable-read; exchange GETs timestamped separately, not an atomic joint snapshot',
  historyScope:'Same tradeOutcome query scope as deployed circuit; not assumed BTC-account scoped'};
 fs.writeFileSync(out,JSON.stringify(r,null,2),{flag:'wx'});
 console.log(JSON.stringify({asOf:r.asOf,wallet:r.account.current_balance,dailyBaseline:r.dailyBaseline,expectancy:r.expectancy,openPositions:r.openPositions,pendingOrders:r.pendingOrders,readyForReplay:false},null,2));
})().catch(()=>{console.error('initial_state_capture_failed');process.exitCode=1;}).finally(()=>prisma.$disconnect());

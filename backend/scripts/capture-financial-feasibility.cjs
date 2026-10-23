// Read-only snapshot: GET-only exchange allowlist, SELECT-only Prisma transaction.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const apps=JSON.parse(cp.execFileSync('pm2',['jlist'],{encoding:'utf8'}));
const worker=apps.find(a=>a.name==='crypto-worker');if(!worker?.pid)throw Error('worker_unavailable');
const runtimeEnv=Object.fromEntries(fs.readFileSync('/proc/'+worker.pid+'/environ','utf8').split('\0').filter(Boolean).map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)];}));
Object.assign(process.env,runtimeEnv);
const build=path.dirname(worker.pm2_env.pm_exec_path);
const {prisma}=require(path.join(build,'lib/prisma'));
const {get}=require(path.join(build,'services/binance/client'));
const {config}=require(path.join(build,'services/binance/config'));
const {getRiskPolicy}=require(path.join(build,'config/risk-policy'));
const {computeExecutionRisk}=require(path.join(build,'utils/execution-risk'));
const {resolveQuantityForMinNotional}=require(path.join(build,'utils/order-quantity'));
const {getAiOpportunityPolicy}=require(path.join(build,'config/ai-opportunity-policy'));
const {financialFeasibilityEnvelope}=require('../src/utils/financial-feasibility-envelope');
const target=path.resolve(process.argv[2]||path.join(root,'../docs/audits/2026-09-27-feasibility'));
const allowed=new Set(['/fapi/v1/exchangeInfo','/fapi/v1/ticker/bookTicker','/fapi/v1/premiumIndex','/fapi/v1/commissionRate','/fapi/v2/balance','/fapi/v2/positionRisk','/fapi/v1/openOrders']);
async function observe(endpoint,params={},signed=false){
 if(!allowed.has(endpoint))throw Error('endpoint_not_allowed');const startedAt=new Date().toISOString();
 try{const data=await get(endpoint,params,signed);return {status:'known',startedAt,receivedAt:new Date().toISOString(),data};}
 catch(e){return {status:'unknown',startedAt,receivedAt:new Date().toISOString(),code:typeof e.binanceCode==='number'?e.binanceCode:null};}
}
async function main(){
 const startedAt=new Date(),risk=getRiskPolicy();if(!getAiOpportunityPolicy().pinned||risk.minSlDistancePercent!==.008||risk.riskPerTradePercent!==.5)throw Error('owner_policy_mismatch');
 const iso=startedAt.toISOString().replaceAll(':','-'),out=path.join(target,iso);fs.mkdirSync(out,{recursive:true});
 const policyKeys=['MAX_EFFECTIVE_RISK_PER_TRADE_USD','MAX_EFFECTIVE_RISK_PER_TRADE_PERCENT','DAILY_LOSS_LIMIT_PERCENT','MIN_SL_DISTANCE_PERCENT','RISK_PER_TRADE_PERCENT','MAX_TOTAL_EXPOSURE_USD','POST_CLOSE_SAME_SIDE_COOLDOWN_MINUTES','POST_LOSS_SAME_SIDE_COOLDOWN_MINUTES','PENDING_ORDER_REENTRY_COOLDOWN_MINUTES','CONSECUTIVE_LOSS_COOLDOWN_HOURS','LOSS_COOLDOWN_TIER2_HOURS','LOSS_COOLDOWN_TIER3_HOURS','LOSS_COOLDOWN_TIER3_UNTIL_UTC_DAY','CIRCUIT_EXPECTANCY_COOLDOWN_HOURS'];
 const codeFiles=['config/risk-policy.js','utils/execution-risk.js','utils/order-quantity.js','services/v3-trade-execution.service.js','services/llm-telemetry.service.js'];
 const hashes=Object.fromEntries(codeFiles.map(f=>[f,sha(fs.readFileSync(path.join(build,f)))]));
 const results=await Promise.all([
  observe('/fapi/v1/exchangeInfo'),observe('/fapi/v1/ticker/bookTicker',{symbol:'BTCUSDT'}),observe('/fapi/v1/premiumIndex',{symbol:'BTCUSDT'}),
  observe('/fapi/v1/commissionRate',{symbol:'BTCUSDT'},true),observe('/fapi/v2/balance',{},true),observe('/fapi/v2/positionRisk',{symbol:'BTCUSDT'},true),observe('/fapi/v1/openOrders',{symbol:'BTCUSDT'},true),
 ]);
 const names=['filters','book','mark','commission','balances','positions','orders'],exchange=Object.fromEntries(names.map((n,i)=>[n,results[i]]));
 if(exchange.filters.status==='known')exchange.filters.data=exchange.filters.data.symbols?.find(s=>s.symbol==='BTCUSDT')??null;
 if(exchange.balances.status==='known'){
  const b=exchange.balances.data?.find(s=>s.asset==='USDT');
  exchange.balances.data=b?Object.fromEntries(['asset','balance','availableBalance','crossWalletBalance','crossUnPnl','updateTime'].map(k=>[k,b[k]])):null;
 }
 if(exchange.positions.status==='known')exchange.positions.data=exchange.positions.data.filter(s=>s.symbol==='BTCUSDT').map(s=>({symbol:s.symbol,positionAmt:s.positionAmt,entryPrice:s.entryPrice,markPrice:s.markPrice}));
 if(exchange.orders.status==='known')exchange.orders.data={count:exchange.orders.data.length};
 const dayStart=new Date(Math.floor((+startedAt+7*3600000)/86400000)*86400000-7*3600000);
 const account=await prisma.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const a=await tx.testnetAccount.findFirst({where:{symbol:'BTC',method_id:'kim_nghia'},select:{id:true,current_balance:true,equity:true,starting_balance:true}});if(!a)throw Error('account_unavailable');
  const previous=await tx.testnetAccountSnapshot.findFirst({where:{account_id:a.id,timestamp:{lt:dayStart}},orderBy:{timestamp:'desc'},select:{timestamp:true,equity:true}});
  const open=await tx.testnetPosition.count({where:{symbol:'BTC',status:'open',size_qty:{gt:0}}});
  return {...a,dayStart:dayStart.toISOString(),previous,openPositions:open};
 },{isolationLevel:'RepeatableRead'});
 const policy=Object.fromEntries(policyKeys.map(k=>[k,runtimeEnv[k]??null]));
 const rawFilters=exchange.filters.data?.filters,filter=k=>rawFilters?.find(f=>f.filterType===k);
 const filters={minQty:Number(filter('LOT_SIZE')?.minQty),maxQty:Number(filter('LOT_SIZE')?.maxQty),stepSize:Number(filter('LOT_SIZE')?.stepSize),minNotional:Number(filter('MIN_NOTIONAL')?.notional),tickSize:Number(filter('PRICE_FILTER')?.tickSize)};
 const entry=Number(exchange.mark.data?.markPrice),envelopes=[];
 const previous=account.previous?.equity;
 const daily=Number.isFinite(previous)&&previous>0&&Number.isFinite(account.equity)?Math.max(0,previous*risk.dailyLossLimitPercent/100-Math.max(0,previous-account.equity)):null;
 const exposure=Math.min(risk.maxTotalExposureUsd,risk.maxExposurePercentOfEquity>0?account.current_balance*risk.maxExposurePercentOfEquity/100:Infinity);
 if(Object.values(filters).every(n=>Number.isFinite(n)&&n>0)&&entry>0){
  const common={entry,balance:account.current_balance,minSlFraction:risk.minSlDistancePercent,feePercent:risk.maxFeePercent,maxRiskPercent:risk.maxEffectiveRiskPerTradePercent,maxRiskUsd:risk.maxEffectiveRiskPerTradeUsd,exposureUsd:exposure,remainingDailyRiskUsd:daily,filters};
  for(const [scenario,slippagePercent]of [['configured_reserve',risk.maxSlippagePercent],['stress_reserve_diagnostic',Math.max(.2,risk.maxSlippagePercent)]])envelopes.push({scenario,slippagePercent,...financialFeasibilityEnvelope({...common,slippagePercent})});
 }
 // Compare observer source calculations against the actual deployed modules.
 const calculationParity=envelopes.length>0&&envelopes.every(e=>{
  const quantity=resolveQuantityForMinNotional({quantity:0,entryPrice:entry,minNotionalUsd:filters.minNotional,minQty:filters.minQty,stepSize:filters.stepSize,tolerancePercent:0});
  return quantity.valid&&Math.abs(quantity.normalizedQty-e.quantity)<1e-12&&e.sides.every(s=>{
   const actual=computeExecutionRisk({entry,stopLoss:s.stopAtFloor,quantity:e.quantity,balance:account.current_balance,roundTripFeePercent:risk.maxFeePercent,slippagePercent:e.slippagePercent});
   return Object.keys(actual).every(k=>Math.abs(actual[k]-s.floorRisk[k])<1e-10);
  });
 });
 const runtimeUnchanged=codeFiles.every(f=>sha(fs.readFileSync(path.join(build,f)))===hashes[f])&&fs.readFileSync('/proc/'+worker.pid+'/environ','utf8').split('\0').filter(Boolean).every(s=>{const i=s.indexOf('=');return runtimeEnv[s.slice(0,i)]===s.slice(i+1);});
 const exchangeWallet=exchange.balances.status==='known'?Number(exchange.balances.data?.balance):NaN;
 const balanceReconciled=Number.isFinite(exchangeWallet)?Math.abs(exchangeWallet-account.current_balance)<1e-8:null;
 const sourceHashes=Object.fromEntries([__filename,path.join(root,'src/utils/financial-feasibility-envelope.ts')].map(f=>[path.relative(root,f),sha(fs.readFileSync(f))]));
 const riskInputs={minSlFraction:risk.minSlDistancePercent,feePercent:risk.maxFeePercent,slippagePercent:risk.maxSlippagePercent,maxRiskPercent:risk.maxEffectiveRiskPerTradePercent,maxRiskUsd:risk.maxEffectiveRiskPerTradeUsd,exposureUsd:exposure,remainingDailyRiskUsd:daily};
 const report={startedAt:startedAt.toISOString(),completedAt:new Date().toISOString(),venue:new URL(config.BASE_URL).origin,workerPid:worker.pid,workerStartedAt:worker.pm2_env.pm_uptime,policy,riskInputs,hashes,runtimeUnchanged,calculationParity,account,exchange,filters,envelopes,balanceReconciled,
  admission:'unknown: diagnostic not executor approval; occupancy, pending/algo reservations, collateral availability, circuit and cooldown still apply',
  limits:['Exchange GETs and DB snapshot are not an atomic joint snapshot.','Envelope uses mark-price proxy; actual entry and price tick must be validated per plan.','Exposure here is configured total ceiling, not residual exposure after all positions/orders.','Missing daily equity baseline remains unknown; no substitution of zero.','Commission tier is observational; configured risk reserve stays unchanged.','No strategy/backtest/ROI or unique opportunity frequency claim.']};
 fs.writeFileSync(path.join(out,'snapshot.json'),JSON.stringify(report,null,2),{flag:'wx'});
 fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({snapshotSha256:sha(fs.readFileSync(path.join(out,'snapshot.json'))),sources:sourceHashes},null,2));
 console.log(JSON.stringify({out,venue:report.venue,balance:account.current_balance,mark:entry,filters,envelopes,unknown:names.filter(n=>exchange[n].status==='unknown'),runtimeUnchanged},null,2));
}
main().catch(()=>{console.error('feasibility_capture_failed; no production mutation performed');process.exitCode=1;}).finally(()=>prisma.$disconnect());

'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {PrismaClient}=require('@prisma/client');const {createProductionPortfolioRuntime}=require('./production-portfolio-runtime.cjs');
const {createPortfolioCommandJournal}=require('./portfolio-command-journal-outstanding.cjs');const {exportHistoricalTerminal}=require('./historical-terminal-export.cjs');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'docs/audits/2026-10-07-causal-lifecycle/run-json-normalized'),prior=path.join(root,'docs/audits/2026-10-07-h2-permission-boundary/workflow-schema-probe');
if(fs.existsSync(out))throw Error('new_output_required');fs.mkdirSync(out,{mode:0o700});
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');const proof=JSON.parse(fs.readFileSync(path.join(prior,'proof.json')));
assert.equal(proof.passed,true);assert.equal(proof.pending_count,1);assert.equal(proof.exchange.fills.length,0);
const c=JSON.parse(cp.execFileSync('docker',['inspect','roi-close-atomic-test-20261003'],{encoding:'utf8'}))[0],e=Object.fromEntries(c.Config.Env.map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)]}));
assert.equal(c.NetworkSettings.Ports['5432/tcp'][0].HostPort,'55439');assert.equal(c.NetworkSettings.Ports['5432/tcp'][0].HostIp,'127.0.0.1');
const schema='engine_causal_range_schema_20261007',url=new URL(`postgresql://${encodeURIComponent(e.POSTGRES_USER)}:${encodeURIComponent(e.POSTGRES_PASSWORD)}@127.0.0.1:55439/crypto_reset_test`);url.searchParams.set('schema',schema);url.searchParams.set('connection_limit','1');
let db,runtime,journal,exchange,ledger,at=Date.parse('2025-02-01T00:00:05Z'),stopped=false;
const result={status:'running',scope:'resumed existing modeled admission lifecycle only; no new scheduler entries or economic portfolio comparison',wall_started_at:Date.now(),provider_calls:0,network_calls:0,economic_roi:null,steps:[],reconstruction_verified:false};
process.on('SIGTERM',()=>{stopped=true;result.stop_requested='SIGTERM';});
const compact=()=>fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify({status:result.status,at,steps:result.steps.length,reconstruction_verified:result.reconstruction_verified}),{mode:0o600});
(async()=>{
 const runtimeRoot=path.join(prior,'runtime'),policy=JSON.parse(fs.readFileSync(path.join(root,'docs/audits/2026-10-07-journal-throughput/policy.json')));
 const datasetPath=path.join(root,'docs/audits/2026-09-11/opportunity-testbed/train-data.json').replace('/2026-09-11/opportunity','/2026-09-11-opportunity'),expectedSha256=hash(datasetPath);
 const manifest={schema,prior_proof_sha256:hash(path.join(prior,'proof.json')),runtime_root:runtimeRoot,runtime_manifest_sha256:hash(path.join(prior,'runtime-manifest.json')),dataset_sha256:expectedSha256,policy,source_hashes:Object.fromEntries(['resume-causal-pending-lifecycle.cjs','production-portfolio-runtime.cjs','portfolio-command-journal-outstanding.cjs','historical-terminal-export.cjs','historical-order-exchange.cjs','historical-exchange-ledger.cjs','historical-candle-adapter.cjs','historical-market-adapter.cjs'].map(f=>[f,hash(path.join(__dirname,f))]))};
 fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});
 db=new PrismaClient({datasources:{db:{url:url.toString()}}});await db.$executeRawUnsafe("SET statement_timeout='5s'");
 assert.deepEqual(JSON.parse(JSON.stringify(await db.testnetAccount.findMany())),proof.terminal_account,'original account/history changed since cutoff');
 const pending=await db.testnetPendingOrder.findFirstOrThrow({where:{status:'pending'}});assert.equal(pending.binance_order_id,'100000');assert.equal(pending.order_id,proof.steps.at(-1).result.execution.orderId);
 const decision=await db.tradeDecision.findFirstOrThrow({where:{id:pending.trade_decision_id??undefined},orderBy:{id:'desc'}}).catch(()=>null);
 const {createHistoricalCandleAdapter}=require('./historical-candle-adapter.cjs'),{createHistoricalMarketAdapter}=require('./historical-market-adapter.cjs');
 const {createHistoricalExchangeLedger}=require('./historical-exchange-ledger.cjs'),{createHistoricalOrderExchange}=require('./historical-order-exchange.cjs');
 const candles=createHistoricalCandleAdapter({datasetPath,expectedSha256,readClock:()=>at});ledger=createHistoricalExchangeLedger({seedAt:at,readClock:()=>at});
 exchange=createHistoricalOrderExchange({seedAt:at,capital:31.47744546,readClock:()=>at,ledger,feeRate:.0005,minQty:.001,stepSize:.001,minNotional:50,fundingRows:JSON.parse(fs.readFileSync(datasetPath)).funding});
 const market=createHistoricalMarketAdapter({datasetPath,expectedSha256,readClock:()=>at,candleAdapter:candles});
 for(const step of proof.steps){at=step.at;exchange.advanceClosedMinute(candles.getCandles({symbol:'BTC',timeframe:'1m',limit:1}).candles.at(-1));}
 const oldOrder=proof.exchange.orders[0];await exchange.adapter.placeLimitOrder({},oldOrder.symbol,oldOrder.side,oldOrder.qty,oldOrder.price,oldOrder.intent);
 assert.deepEqual(JSON.parse(JSON.stringify(exchange.snapshot())),proof.exchange,'modeled state reconstruction mismatch');result.reconstruction_verified=true;result.initial_account=proof.terminal_account;result.initial_exchange=exchange.snapshot();
 const exposure=async()=>await db.testnetPosition.findMany({where:{status:'open'}});
 const priceView=async(symbol)=>{const b=candles.getCandles({symbol,timeframe:'1m',limit:1}).candles.at(-1);return {price:b.close,open:b.open,high:b.high,low:b.low,volume:b.volume,time:new Date(b.timestamp).toISOString()};};
 // Reuse exactly the historical adapter boundary, without invoking its probe.
 const source=fs.readFileSync(path.join(__dirname,'probe-causal-range-schema-workflow.cjs'),'utf8');const start=source.indexOf(" adapters={'services/price-fetcher'"),end=source.indexOf("\n delete adapters['services/groq-client'];",start);assert(start>=0&&end>start);
 let adapters;eval(source.slice(start,end));delete adapters['services/groq-client'];for(const key of ['services/openrouter-client','services/memory.service','services/llm-telemetry.service','services/openrouter-shadow.service'])delete adapters[key];
 adapters.providerFetch=async()=>{result.provider_calls++;throw Error('unregistered_lifecycle_provider_request');};
 journal=createPortfolioCommandJournal({database:db,positionId:'pipeline_v3_kim_nghia',storageSchema:schema});await journal.prepare();
 runtime=createProductionPortfolioRuntime({runtimeRoot,database:db,environment:{...policy.environment,CAUSAL_OPPORTUNITY_RESEARCH_ENABLED:'true',OPENROUTER_API_KEY:'no-network-lifecycle-boundary'},externalAdapters:adapters,initialClock:at,externalStateSnapshot:()=>exchange.snapshot(),commandJournal:journal});
 const begin=at,endAt=begin+2*3600000;const plan=proof.steps.at(-1).result.review.analysis;const expires=1738872305000;result.start=begin;result.end=endAt;result.review_invalidation=plan.invalidation_level;
 for(at=begin+60000;at<=endAt;at+=60000){
  if(stopped||Date.now()-result.wall_started_at>=175000){result.status='registered_wall_cutoff_reached';break;}
  const bar=candles.getCandles({symbol:'BTC',timeframe:'1m',limit:1}).candles.at(-1);const fills=exchange.advanceClosedMinute(bar);
  for(const fill of fills){const order=await db.testnetPendingOrder.findFirst({where:{binance_order_id:String(fill.orderId),status:'pending'}});
   if(order)await runtime.step({kind:'fill',at,orderId:order.order_id,executedQty:fill.qty,avgPrice:fill.price,eventTime:fill.time});
   else{const p=await db.testnetPosition.findFirst({where:{status:'open',OR:[{binance_sl_order_id:String(fill.orderId)},{binance_tp_order_id:String(fill.orderId)}]}});if(!p)throw Error('unlinked_exchange_close_fill');await runtime.step({kind:'close',at,positionId:p.position_id,price:fill.price,reason:p.binance_sl_order_id===String(fill.orderId)?'stop_loss':'take_profit',eventMeta:{binance_order_id:String(fill.orderId),execution_basis:'modeled_exchange_fill'}});}
  }
  const activePending=await db.testnetPendingOrder.findUnique({where:{order_id:pending.order_id}});if(at>=expires&&activePending.status==='pending')await runtime.step({kind:'cancel',at,orderId:pending.order_id,reason:'causal_setup_expired'});
  if((at-begin)%300000===0)await runtime.step({kind:'balance_sync',at});
  if(await db.testnetPosition.count({where:{status:'open'}}))await runtime.step({kind:'monitor',at});
  result.steps.push({at,fills});compact();
 }
 if(result.status==='running')result.status='lifecycle_window_completed';
})().catch(e=>{result.status='failed';result.failure=e.message;process.exitCode=1}).finally(async()=>{
 await exportHistoricalTerminal({out,result,database:db,runtime,journal,captureDerivedResult:()=>({exchange:exchange?.snapshot(),ledger:ledger?.diagnostics()})});
 console.log(JSON.stringify({status:result.status,steps:result.steps.length,reconstruction_verified:result.reconstruction_verified,fills:result.exchange?.fills.length,provider_calls:result.provider_calls,failure:result.failure,terminal_export_complete:result.terminal_export_complete}));
});

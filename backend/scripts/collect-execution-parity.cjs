// Read-only DB export; no exchange, scheduler, execution or reconcile imports.
require('dotenv').config({quiet:true});
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {prisma}=require('../dist/lib/prisma');
const [sinceArg,outArg,throughArg]=process.argv.slice(2);if(!sinceArg||!outArg)throw Error('Usage: node scripts/collect-execution-parity.cjs SINCE_ISO NEW_OUTPUT.json [THROUGH_ISO]');
const since=new Date(sinceArg),through=throughArg?new Date(throughArg):new Date();if(!Number.isFinite(+since)||!Number.isFinite(+through)||since>=through||through>new Date())throw Error('Invalid interval');
const allowed=new Set(['trace_id','candidate_key','observation_key','decision_id','lane','policy_hash','code_hash','input_hash','state_hash','evaluated_at','candle_cutoff','stage','order_id','binance_order_id','symbol','side','action','entry','entry_price','planned_entry','stop_loss','take_profit','size_qty','executed_qty','timestamp','reason','status','success','decision','request_id','cost_usd','cost_status','provider','model','latency_ms','normalized_quantity','raw_quantity','totalRiskUsd','riskPercent','cap_usd','initial_risk_usd','reconciliation_backfill','linkage_status']);
// Preserve contemporaneous admission evidence; never substitute today's account state.
for(const key of ['rejection_code','remaining_daily_risk_usd','remaining_exposure_usd','order_notional','min_qty','step_size','min_notional','raised_to_minimum','priceRiskUsd','feeReserveUsd','slippageReserveUsd','source','gate'])allowed.add(key);
for(const key of ['evaluation','entry_source','observed_at','data_status'])allowed.add(key);
// The pre-AI geometry observer is evidence, not a replacement for admission.
for(const key of ['measurement','cached_analysis'])allowed.add(key);
for(const key of ['admission_schema','account_balance','target_risk_percent','target_risk_usd',
 'computed_size_usd','selected_notional_usd','notional_tolerance_percent','effective_min_notional',
 'admission_fee_percent','admission_slippage_percent','max_risk_percent','max_risk_usd'])allowed.add(key);
for(const key of ['avg_price','size_usd','account_equity','close_price','close_reason','realized_pnl',
 'fill_verified','fill_source','binance_fill_ids','close_qty','bookkeeping_close','outcome','context',
 'binance_sl_order_id','binance_tp_order_id','position_id','order_type','position_closed'])allowed.add(key);
for(const key of ['acknowledgement_schema','protection_type','trigger_price','request_started_at',
 'acknowledgement_received_at','exchange_status','working_type','acknowledgement_data_status'])allowed.add(key);
(async()=>{
 const types=['entry_trace','pending_order_linked','entry_order_filled','partial_fill','pending_order_cancelled','execution_blocked','llm_provider_request','llm_provider_result',
 'position_closed','protective_failed','protective_order_incomplete','algo_order_filled','untracked_exposure_protective_close','protective_order_acknowledged'];
 const events=[];let cursor=0,malformed=0;
 for(;;){const page=await prisma.testnetTradeEvent.findMany({where:{id:{gt:cursor},timestamp:{gte:since,lte:through},event_type:{in:types}},orderBy:{id:'asc'},take:1000,select:{id:true,position_id:true,event_type:true,event_data:true,timestamp:true}});if(!page.length)break;
  for(const r of page){let d;try{d=JSON.parse(r.event_data||'{}');if(!d||typeof d!=='object'||Array.isArray(d))throw Error();}catch{malformed++;continue;}events.push({...r,event_data:Object.fromEntries(Object.entries(d).filter(([k])=>allowed.has(k)))});}cursor=page.at(-1).id;if(events.length>100000)throw Error('Export exceeds limit; narrow interval');
 }
 const ids=[...new Set(events.flatMap(e=>typeof e.event_data.order_id==='string'?[e.event_data.order_id]:[]))];
 const orders=await prisma.testnetPendingOrder.findMany({where:{OR:[{created_at:{gte:since,lte:through}},{order_id:{in:ids}}],symbol:'BTC'},select:{order_id:true,symbol:true,side:true,entry_price:true,stop_loss:true,take_profit:true,size_qty:true,status:true,created_at:true,executed_at:true,executed_price:true,executed_size_qty:true,binance_order_id:true}});
 const lifecycleTypes=new Set(['entry_order_filled','position_closed','protective_failed','protective_order_incomplete','protective_order_acknowledged']);
 const positionIds=[...new Set(events.filter(e=>lifecycleTypes.has(e.event_type)).map(e=>e.position_id))];
 const positions=await prisma.testnetPosition.findMany({where:{OR:[{entry_time:{gte:since,lte:through}},{close_time:{gte:since,lte:through}},{position_id:{in:positionIds}}],symbol:'BTC'},select:{position_id:true,side:true,entry_price:true,size_qty:true,status:true,entry_time:true,close_time:true,close_price:true,close_reason:true,entry_fee:true,exit_fee:true,funding_fee:true,realized_pnl:true,partial_closed:true,binance_order_id:true,binance_sl_order_id:true,binance_tp_order_id:true}});
 const result={schema:'execution-parity-export-v1',exportedEventTypes:types,exportedFields:[...allowed].sort(),since:since.toISOString(),through:through.toISOString(),capturedAt:new Date().toISOString(),malformed,consistency:'Bounded read-only queries, not a repeatable-read transaction. Costs are DB-recorded, not independently exchange-verified. Snapshot protective IDs do not prove acknowledgement time.',events,orders,positions};
 const bytes=JSON.stringify(result,null,2),file=path.resolve(outArg);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes,{flag:'wx'});console.log(JSON.stringify({events:events.length,orders:orders.length,positions:positions.length,malformed,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>prisma.$disconnect());

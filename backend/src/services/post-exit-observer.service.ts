import {get} from './binance/client';
import {observeRangeMirror,type FundingObservation} from '../utils/range-mirror-observation';
/** Read-only DB/market access; durable observation files, no execution imports or DB mutations. */
import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {prisma} from '../lib/prisma';
import {getKlines,getServerTime} from './binance/market';
import {analyzePostExit,postExitLesson,type ObservationBar,type ObservedTrade,type PostExitResult} from '../utils/post-exit-analysis';
import {getPendingOrderTtlHours} from '../config/pending-order-policy';
import {resolveLlmShadowOutcome,type LlmShadowPlan,type LlmShadowOutcome} from '../utils/llm-shadow-outcome';
export function observationRoot(){return resolve(process.env.POST_EXIT_DATA_DIR||resolve(__dirname,'../../data/post-exit'));}
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function read<T>(p:string):T|null {try{return JSON.parse(readFileSync(p,'utf8')) as T;}catch{return null;}}
function save(p:string,x:unknown){mkdirSync(resolve(p,'..'),{recursive:true});const tmp=p+'.tmp';writeFileSync(tmp,JSON.stringify(x));renameSync(tmp,p);}
async function loadMinutes(from:number,to:number):Promise<ObservationBar[]>{
 const root=join(observationRoot(),'candles');mkdirSync(root,{recursive:true});const result:ObservationBar[]=[];
 for(let day=Math.floor(from/86400000)*86400000;day<to;day+=86400000){
  const file=join(root,day+'.json');const old=read<ObservationBar[]>(file)||[];
  const end=Math.min(day+86400000,to);let cursor=old.length?old[old.length-1].openTime+60000:day;
  if(cursor<end){
   const page=await getKlines('BTCUSDT','1m',1500,cursor,end-1);
   for(const b of page){if(b.openTime>=end)continue;if(b.openTime!==cursor)throw Error('minute_gap');old.push(b);cursor+=60000;}
   if(cursor!==end)throw Error('incomplete_page');save(file,old);
  }
  result.push(...old.filter(b=>b.openTime>=from&&b.openTime<to));
 }
 return result;
}
type StoredModelShadow={eventId:number;availableAt:number;decision:Record<string,unknown>;plan:LlmShadowPlan;outcome?:LlmShadowOutcome;updatedAt?:number};
function finishedShadow(outcome:LlmShadowOutcome|undefined){return outcome?.status==='resolved'||outcome?.status==='expired_without_fill';}
async function observeModelShadows(root:string,server:number,endNow:number,started:number,failures:Array<{id:string;error:string}>){
 const cursorFile=join(root,'model-shadow-cursor.json');
 const cursor=read<{id:number}>(cursorFile)||{id:0};
 const rows=await prisma.testnetTradeEvent.findMany({where:{id:{gt:cursor.id},event_type:'llm_model_shadow_decision'},orderBy:{id:'asc'},take:200});
 const dir=join(root,'model-shadow');mkdirSync(dir,{recursive:true});
 for(const row of rows){
  try{
   const d=JSON.parse(row.event_data||'null') as Record<string,unknown>|null;
   if(d?.valid===true&&d.would_confirm===true&&(d.action==='buy'||d.action==='sell')){
    const timeframe=String(d.timeframe||'');
    const plan:LlmShadowPlan={eventId:row.id,model:String(d.model||'unknown'),symbol:String(d.symbol||'BTC'),timeframe,
     action:d.action,confidence:Number(d.confidence),entry:Number(d.suggested_entry),stop:Number(d.suggested_stop_loss),
     target:Number(d.suggested_take_profit),availableAt:row.timestamp.getTime(),ttlMs:getPendingOrderTtlHours(timeframe)*3600000,
     maxHoldMs:Number(process.env.OPENROUTER_SHADOW_MAX_HOLD_HOURS||48)*3600000};
    if([plan.confidence,plan.entry,plan.stop,plan.target,plan.ttlMs,plan.maxHoldMs].every(Number.isFinite))
     save(join(dir,row.id+'.json'),{eventId:row.id,availableAt:row.timestamp.getTime(),decision:d,plan} satisfies StoredModelShadow);
    else failures.push({id:'model-shadow-'+row.id,error:'invalid_shadow_levels'});
   }
  }catch(e){failures.push({id:'model-shadow-'+row.id,error:e instanceof Error?e.message:'invalid_shadow_event'});}
  cursor.id=row.id;
 }
 save(cursorFile,cursor);
 for(const name of readdirSync(dir).filter(f=>f.endsWith('.json'))){
  if(Date.now()-started>45000)break;
  const file=join(dir,name),stored=read<StoredModelShadow>(file);if(!stored||finishedShadow(stored.outcome))continue;
  try{
   const start=Math.ceil(stored.plan.availableAt/60000)*60000;
   const deadline=start+stored.plan.ttlMs+stored.plan.maxHoldMs;
   const end=Math.min(endNow,deadline);
   const bars=end>start?await loadMinutes(start,end):[];
   const funding=end>start?await get('/fapi/v1/fundingRate',{symbol:'BTCUSDT',startTime:start,endTime:end-1,limit:1000}) as FundingObservation[]:[];
   if(!Array.isArray(funding)||funding.some(f=>!Number.isFinite(Number(f.fundingRate))||!(Number(f.markPrice)>0)))throw Error('invalid_funding');
   stored.outcome=resolveLlmShadowOutcome({plan:stored.plan,bars,funding,asOf:server});stored.updatedAt=Date.now();save(file,stored);
  }catch(e){failures.push({id:'model-shadow-'+stored.eventId,error:e instanceof Error?e.message:'shadow_observation_failed'});}
 }
 const observations=readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>read<StoredModelShadow>(join(dir,f))).filter((x):x is StoredModelShadow=>x!==null);
 const eligible=observations.filter(x=>x.outcome?.status==='resolved'&&x.outcome.promotionEligible);
 const byModel=Object.fromEntries([...new Set(observations.map(x=>x.plan.model))].map(model=>{
  const all=observations.filter(x=>x.plan.model===model),resolved=all.filter(x=>x.outcome?.status==='resolved'&&x.outcome.promotionEligible);
  return [model,{decisions:all.length,resolved:resolved.length,winsStress:resolved.filter(x=>(x.outcome?.stressNetUsd??0)>0).length,
   baseNetUsd:resolved.reduce((s,x)=>s+(x.outcome?.baseNetUsd??0),0),stressNetUsd:resolved.reduce((s,x)=>s+(x.outcome?.stressNetUsd??0),0)}];
 }));
 save(join(root,'model-shadow-summary.json'),{version:1,updatedAt:Date.now(),serverTime:server,decisionEvents:observations.length,
  pending:observations.filter(x=>!finishedShadow(x.outcome)).length,expired:observations.filter(x=>x.outcome?.status==='expired_without_fill').length,
  resolvedEligible:eligible.length,entryMinuteAmbiguous:observations.filter(x=>x.outcome?.entryMinuteAmbiguous).length,byModel,
  limits:'Independent 0.001 BTC paths; limit-touch proxy, fixed submitted levels, conservative SL-first, actual funding proxy, 0.10% fees plus 0.10%/0.20% slippage. Not an account portfolio.'});
 return cursor.id;
}
let running=false;
export async function runPostExitObserver(){
 if(running)return;running=true;const started=Date.now(),root=observationRoot();mkdirSync(root,{recursive:true});
 try{
  const server=await getServerTime(),endNow=Math.floor(server/60000)*60000;
  const positions=await prisma.testnetPosition.findMany({where:{symbol:'BTC',status:'closed',close_time:{not:null},entry_time:{gte:new Date('2026-08-01')}},orderBy:{close_time:'desc'}});
  const events=await prisma.testnetTradeEvent.findMany({where:{position_id:{in:positions.map(p=>p.position_id)},event_type:'entry_order_filled'}});
  let updated=0;const failures:Array<{id:string;error:string}>=[];
  for(const p of positions){
   if(Date.now()-started>45000)break;
   try{
    const ev=events.find(e=>e.position_id===p.position_id);if(!ev)continue;const e=JSON.parse(ev.event_data ?? "null");
    if(!e)continue;
    const trade:ObservedTrade={id:p.position_id,side:p.side as 'long'|'short',entry:p.entry_price,initialStop:Number(e.stop_loss),target:Number(e.take_profit),
     entryTime:p.entry_time.getTime(),exitTime:p.close_time!.getTime(),exit:p.close_price!,quantity:p.size_qty,net:p.realized_pnl,
     costs:(p.entry_fee||0)+(p.exit_fee||0)+(p.funding_fee||0)};
    const revision=hash({trade,version:"post-exit-v1.1"}),file=join(root,'positions',p.position_id+'.json');
    const previous=read<{revision:string;result:PostExitResult}>(file);
    const completeAt=trade.exitTime+72*3600000;
    if(previous?.revision===revision&&previous.result.asOf>=completeAt&&previous.result.after.every(w=>w.status==='complete'))continue;
    const until=Math.min(endNow,Math.floor(completeAt/60000)*60000);
    const bars=await loadMinutes(Math.ceil(trade.entryTime/60000)*60000,until);
    const result=analyzePostExit(trade,bars,server);
    if(previous&&previous.revision!==revision)save(join(root,'revisions',p.position_id+'-'+previous.revision+'.json'),previous);
    save(file,{revision,decisionId:e.decision_id,symbol:p.symbol,closeReason:p.close_reason,recordedAt:Date.now(),result});updated++;
   }catch(e){failures.push({id:p.position_id,error:e instanceof Error?e.message:'observation_failed'});}
  }
  const modelShadowCursor=await observeModelShadows(root,server,endNow,started,failures);
  // Snapshot every newly persisted confirmed range candidate, including AI/execution vetoes.
  const cursorFile=join(root,'candidate-cursor.json');
  const cursor=read<{id:number}>(cursorFile)||{id:0};
  const candidates=await prisma.testnetTradeEvent.findMany({where:{id:{gt:cursor.id},event_type:'transition_retest_confirmed'},orderBy:{id:'asc'},take:200});
  for(const row of candidates){
   const c=JSON.parse(row.event_data ?? "null");
   if(c&&c.candidate_kind==='range_sweep_reclaim'&&c.side==='long'){
    save(join(root,'candidates',hash(c.candidate_key)+'.json'),{eventId:row.id,availableAt:row.timestamp.getTime(),capturedAt:Date.now(),candidate:c,
     mirror:{side:'short',entry:c.entry_price,stopLoss:2*c.entry_price-c.stop_loss,takeProfit:2*c.entry_price-c.take_profit},
     status:'observed_not_executed',limits:'Candidate inventory from existing confirmation events; upstream unconfirmed/vetoed-before-confirmation signals excluded.'});
   }
   cursor.id=row.id;save(cursorFile,cursor);
  }
  const candidateDir=join(root,'candidates');
  if(existsSync(candidateDir))for(const name of readdirSync(candidateDir).filter(f=>f.endsWith('.json')).reverse()){
   if(Date.now()-started>45000)break;
   const file=join(candidateDir,name),row=read<any>(file);if(!row||row.observation?.paths?.every((p:any)=>p.reason!=='pending')&&row.observation?.status==='observed')continue;
   try{
    const c=row.candidate,time=Math.max(Date.parse(c.confirmed_at),row.availableAt),start=Math.ceil(time/60000)*60000;
    if(!Number.isFinite(start)||start>endNow)continue;
    const end=Math.min(endNow,start+72*3600000),bars=await loadMinutes(start,end);
    const funding=await get('/fapi/v1/fundingRate',{symbol:'BTCUSDT',startTime:start,endTime:end-1,limit:1000}) as FundingObservation[];
    if(!Array.isArray(funding)||funding.some(f=>!Number.isFinite(Number(f.fundingRate))||!(Number(f.markPrice)>0)))throw Error('invalid_funding');
    row.observation=observeRangeMirror({entry:c.entry_price,stop:c.stop_loss,target:c.take_profit,time,asOf:server,bars,funding});
    row.updatedAt=Date.now();save(file,row);
   }catch(e){failures.push({id:name,error:e instanceof Error?e.message:'candidate_observation_failed'});}
  }
  const reports=readObservationReports();
  save(join(root,'summary.json'),{version:1,updatedAt:Date.now(),serverTime:server,positions:reports.length,updated,failures,
   reports:reports.map(r=>({id:r.result.position.id,decisionId:r.decisionId,net:r.result.position.net,lesson:postExitLesson(r.result,server),windows:r.result.after.map(w=>({minutes:w.minutes,status:w.status}))}))});
  console.log(`[PostExitObserver] positions=${reports.length} updated=${updated} failures=${failures.length} candidateCursor=${cursor.id} modelShadowCursor=${modelShadowCursor}`);
 }finally{running=false;}
}
export function readObservationReports():Array<{decisionId:number;symbol:string;result:PostExitResult}>{
 const dir=join(observationRoot(),'positions');if(!existsSync(dir))return [];
 return readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>read<{decisionId:number;symbol:string;result:PostExitResult}>(join(dir,f))).filter((r):r is NonNullable<typeof r>=>r!==null);
}

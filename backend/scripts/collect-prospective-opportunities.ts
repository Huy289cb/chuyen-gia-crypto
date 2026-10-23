/** Read-only market observation + bounded AI classification. No DB, scheduler or order clients. */
import 'dotenv/config';
import {mkdirSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {getAiOpportunityPolicy} from '../src/config/ai-opportunity-policy';
import {buildProspectiveCohort,PROSPECTIVE_COHORT_VERSION,PROSPECTIVE_UNION_VERSION} from '../src/backtest/prospective-opportunity';
import {AI_OPPORTUNITY_PROMPT,parseOpportunityChoice,type OpportunitySnapshot} from '../src/utils/ai-opportunity';
import {requestOpportunityReview} from '../src/services/ai-opportunity-provider';
const {createJournal}=require('./prospective-journal.cjs');
const {startSession}=require('./prospective-session.cjs');
const unionStudy=process.argv.includes('--union-study');
const cohortVersion=unionStudy?PROSPECTIVE_UNION_VERSION:PROSPECTIVE_COHORT_VERSION;
const dir=resolve(unionStudy?'../docs/audits/2026-09-13-prospective-union':'../docs/audits/2026-09-12-prospective-opportunity');mkdirSync(dir,{recursive:true,mode:0o700});
const journal=createJournal(dir),policy={...getAiOpportunityPolicy(),mode:'shadow' as const},wallet=33.59964603;
if(!policy.pinned||policy.targetPercent!==.5)throw new Error('paper_policy_unpinned');
const binaryHash=createHash('sha256').update(readFileSync(__filename)).digest('hex');
const promptHash=createHash('sha256').update(AI_OPPORTUNITY_PROMPT).digest('hex');
const steps:Record<string,number>={'5m':300000,'15m':900000,'1h':3600000,'4h':14400000};
async function publicData(endpoint:string){
 const response=await fetch('https://fapi.binance.com'+endpoint,{signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error('public_market_unavailable');return response.json();
}
async function capture(){
 const asOf=Date.now();
 try{
  const contexts=await Promise.all(Object.keys(steps).map(async tf=>{
   const rows=await publicData(`/fapi/v1/klines?symbol=BTCUSDT&interval=${tf}&limit=121&endTime=${asOf-1}`);
   if(!Array.isArray(rows))throw new Error('invalid_klines');
   return [tf,rows.map((r:any[])=>({timestamp:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5])}))
    .filter(b=>b.timestamp+steps[tf]<=asOf).slice(-120)] as const;
  }));
  const premium=await publicData('/fapi/v1/premiumIndex?symbol=BTCUSDT');
  if(!Number.isFinite(Number(premium.time))||Math.abs(Date.now()-Number(premium.time))>120000)throw new Error('stale_funding');
  const cohort=buildProspectiveCohort({asOf,policy,candles:Object.fromEntries(contexts) as OpportunitySnapshot['candles'],
   finance:{balance:wallet,remainingDailyRiskUsd:wallet*.1,remainingExposureUsd:policy.maxExposure,allowed:true,
    stepSize:.001,minQty:.001,minNotional:50,fundingRate:Number(premium.lastFundingRate)}},cohortVersion);
  if(!cohort||Date.now()-asOf>policy.maxSnapshotAgeMs)throw new Error('invalid_or_stale_cohort');
  const key='snapshot-'+Math.floor(asOf/900000);
  if(!journal.exclusive(key,{...cohort,capturedAt:Date.now(),binaryHash,promptHash,requestedModel:policy.model,
   version:cohortVersion,publicFundingTimestamp:Number(premium.time),ordersPossible:false})){
   console.log(JSON.stringify({at:new Date().toISOString(),reason:'snapshot_already_recorded'}));return;
  }
  console.log(JSON.stringify({at:new Date().toISOString(),snapshot:key,plans:cohort.snapshot.plans.length,ordersPossible:false}));
  if(!cohort.snapshot.plans.length)return;
  const claim=journal.claimReview(asOf,Math.min(policy.dailyRequests,12));if(!claim)return;
  const started=Date.now();
  try{
   const response=await requestOpportunityReview(AI_OPPORTUNITY_PROMPT,JSON.stringify({...cohort.snapshot,
    study:'Prospective PAPER selection study, fixed hypothetical wallet; no live account authorization or order execution.'}),policy,AbortSignal.timeout(policy.timeoutMs));
   const choice=parseOpportunityChoice(response.content,cohort.snapshot);
   journal.record('result-'+claim.hour,{snapshot:key,claim,receivedAt:Date.now(),latencyMs:Date.now()-started,
    model:response.model,inputTokens:response.inputTokens,outputTokens:response.outputTokens,costUsd:response.costUsd,
    rawContent:response.content,choice,valid:choice!==null,freshAtResponse:Date.now()-asOf<=policy.maxSnapshotAgeMs,
    binaryHash,promptHash,ordersPossible:false});
   console.log(JSON.stringify({at:new Date().toISOString(),review:claim.hour,valid:choice!==null,decision:choice?.decision,costUsd:response.costUsd}));
  }catch{
   journal.record('result-'+claim.hour,{snapshot:key,claim,receivedAt:Date.now(),reason:'provider_failed_closed',costUsd:null,ordersPossible:false});
  }
 }catch{
  const status={at:new Date().toISOString(),reason:'capture_failed_closed',ordersPossible:false};
  journal.exclusive('error-'+asOf,status);console.log(JSON.stringify(status));
 }
}
async function main(){
 const requested=process.argv.find(a=>a.startsWith('--watch-hours='));
 const hours=requested?Number(requested.split('=')[1]):0;
 if(!Number.isFinite(hours)||hours<0||hours>24)throw new Error('invalid_watch_duration');
 const startedAt=Date.now(),stopAt=startedAt+Math.ceil(hours*3600000);
 let loopCompleted=false;
 const finishSession=startSession(dir,{startedAt,stopAt,binaryHash,promptHash,requestedModel:policy.model,
  policyHash:policy.hash,paperWallet:wallet,dailyRequests:Math.min(policy.dailyRequests,12)},Date.now);
 process.once('exit',(code)=>{try{finishSession(code,loopCompleted);}catch{console.error('session_end_record_failed');}});
 do{await capture();if(!hours||Date.now()>=stopAt)break;
  const next=Math.floor(Date.now()/900000)*900000+920000;
  await new Promise(r=>setTimeout(r,Math.min(next-Date.now(),Math.max(0,stopAt-Date.now()))));
 }while(Date.now()<stopAt);
 loopCompleted=true;
}
void main().catch(()=>{console.error('collector_failed_closed');process.exitCode=1;});

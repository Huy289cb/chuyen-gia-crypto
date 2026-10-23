/** Read-only market outcome fetches. Never calls AI or an order endpoint. */
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {evaluateProspectivePair,type ProspectiveReviewRecord} from '../src/backtest/prospective-pair-evaluation';
import type {OpportunitySnapshot,OpportunityCandle} from '../src/utils/ai-opportunity';
const root=process.argv.includes('--union-study')?'../docs/audits/2026-09-13-prospective-union/':'../docs/audits/2026-09-12-prospective-opportunity/';
const protocol=JSON.parse(readFileSync(root+'protocol.json','utf8'));
const frozenAt=Date.parse(protocol.frozenAt),observedThrough=Math.floor(Date.now()/60000)*60000;
const files=readdirSync(root).filter(f=>/^result-\d+\.json$/.test(f));
const output:{snapshot:string;cost:string;result:ReturnType<typeof evaluateProspectivePair>}[]=[];
const issues: {file:string;reason:string}[]=[];
async function get(endpoint:string){
 const r=await fetch('https://fapi.binance.com'+endpoint,{signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw new Error('public_data_unavailable');return r.json();
}
async function main(){
 const cache=root+'outcome-data/';mkdirSync(cache,{recursive:true,mode:0o700});
 for(const file of files){
  try{
   const review=JSON.parse(readFileSync(root+file,'utf8')) as ProspectiveReviewRecord;
   if(!/^snapshot-\d+$/.test(review.snapshot))throw new Error('invalid_snapshot_key');
   const packet=JSON.parse(readFileSync(root+review.snapshot+'.json','utf8')) as {snapshot:OpportunitySnapshot;capturedAt:number;binaryHash:string};
   if(packet.snapshot.asOf<frozenAt)continue;
   if(packet.binaryHash!==protocol.collectorSha256)throw new Error('cohort_binary_mismatch');
   if(!Number.isFinite(review.receivedAt)||review.receivedAt<packet.capturedAt||review.receivedAt>observedThrough)throw new Error('unavailable_response_time');
   const first=Math.ceil(review.receivedAt/60000)*60000,end=Math.min(first+48*3600000,observedThrough);
   const bars:OpportunityCandle[]=[];
   for(let cursor=first;cursor<end;){
    const rows=await get(`/fapi/v1/klines?symbol=BTCUSDT&interval=1m&startTime=${cursor}&endTime=${end-1}&limit=1500`);
    if(!Array.isArray(rows)||!rows.length)break;
    const batch=rows.map((r:any[])=>({timestamp:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5])}));
    const next=batch[batch.length-1].timestamp+60000;if(next<=cursor)throw new Error('nonadvancing_data');
    bars.push(...batch);cursor=next;
   }
   const rows=await get(`/fapi/v1/fundingRate?symbol=BTCUSDT&startTime=${first}&endTime=${end}&limit=1000`);
   if(!Array.isArray(rows)||rows.length>=1000)throw new Error('incomplete_funding_page');
   const funding=rows.map((r:any)=>({time:Number(r.fundingTime),rate:Number(r.fundingRate),markPrice:Number(r.markPrice)}));
   if(funding.some(f=>!Number.isFinite(f.markPrice)||f.markPrice<=0))throw new Error('missing_funding_mark');
   const evidence=JSON.stringify({first,end,fetchedAt:Date.now(),bars,funding,source:'Binance public API',fundingCoverage:'successful bounded historical API response, not account settlement audit'});
   const sha=createHash('sha256').update(evidence).digest('hex');
   writeFileSync(cache+review.snapshot+'-'+end+'.json',evidence,{mode:0o600});
   for(const slip of [.001,.002]){
    const result=evaluateProspectivePair({snapshotKey:review.snapshot,snapshot:packet.snapshot,capturedAt:packet.capturedAt,
     review,bars,funding,fundingCoveredThrough:end,observedThrough,slippageFraction:slip});
    output.push({snapshot:review.snapshot,cost:slip===.001?'base':'stress',result});
   }
   console.log(JSON.stringify({snapshot:review.snapshot,availableBars:bars.length,dataHash:sha}));
  }catch{issues.push({file,reason:'record_or_future_data_unavailable'});}
 }
 const summary={observedThrough,evaluatedRecords:output.length,issues,results:output,promotionEligible:false,
  note:'Matched counterfactuals with actual response time; not portfolio ROI. Missing/censored outcomes and unknown AI cost remain null. No claim from zero observations.'};
 writeFileSync(root+'paired-evaluation.json',JSON.stringify(summary,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({evaluated:output.length,issues:issues.length,promotionEligible:false}));
}
void main().catch(()=>{console.error('evaluation_failed_closed');process.exitCode=1;});

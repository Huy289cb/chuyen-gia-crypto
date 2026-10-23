import 'dotenv/config';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getAiOpportunityPolicy} from '../src/config/ai-opportunity-policy';
import {buildResearchOpportunitySnapshot,type OpportunitySnapshot,type OpportunityCandle,type OpportunityPlan} from '../src/utils/ai-opportunity';
import {evaluateOpportunityOutcome} from '../src/backtest/opportunity-outcome';
const {createSourceGuard}=require('./testbed-source-guard.cjs');
const guard=createSourceGuard(['src',__filename]);
const out='../docs/audits/2026-09-14-target-rejection-study/';mkdirSync(out,{recursive:true});
const policy={...getAiOpportunityPolicy(),mode:'shadow' as const};
if(!policy.pinned||policy.targetPercent!==.5)throw Error('owner_policy_changed');
const records:any[]=[],datasets:any[]=[];
for(const split of ['train','independent-2023']){
 const root='../docs/audits/2026-09-11-opportunity-testbed/'+(split==='train'?'':split+'/');
 const raw=readFileSync(root+split+'-data.json'),manifest=JSON.parse(readFileSync(root+split+'-data-manifest.json','utf8'));
 if(createHash('sha256').update(raw).digest('hex')!==manifest.sha256)throw Error('changed_data');
 datasets.push({split,sha256:manifest.sha256});
 const data=JSON.parse(raw.toString()),candles:Record<string,OpportunityCandle[]>={};
 for(const [tf,rows] of Object.entries(data.byTf))candles[tf]=(rows as number[][]).map(b=>({timestamp:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]}));
 const steps:Record<string,number>={'5m':300000,'15m':900000,'1h':3600000,'4h':14400000},pointers:Record<string,number>={'5m':0,'15m':0,'1h':0,'4h':0};
 let fundingIndex=-1;const seen=new Set<string>();
 for(const b of candles['15m']){
  const asOf=b.timestamp+900000,context={} as OpportunitySnapshot['candles'];
  for(const tf of Object.keys(steps)){
   while(pointers[tf]<candles[tf].length&&candles[tf][pointers[tf]].timestamp+steps[tf]<=asOf)pointers[tf]++;
   context[tf as keyof typeof context]=candles[tf].slice(Math.max(0,pointers[tf]-120),pointers[tf]);
  }
  if(Object.values(context).some(x=>x.length<100)||split==='independent-2023'&&asOf<Date.parse('2023-01-01'))continue;
  while(fundingIndex+1<data.funding.length&&data.funding[fundingIndex+1].time<=asOf)fundingIndex++;
  if(fundingIndex<0)continue;
  const finance={balance:33.59964603,remainingDailyRiskUsd:33.59964603*.1,remainingExposureUsd:policy.maxExposure,allowed:true,stepSize:.001,minQty:.001,minNotional:50,fundingRate:data.funding[fundingIndex].rate};
  for(const setup of ['opening_range_breakout','opening_range_failure'] as const){
   const rejects:{plan:OpportunityPlan;otherBlock:string|null}[]=[];
   const snapshot=buildResearchOpportunitySnapshot({asOf,candles:context,finance,policy},setup,rejects);
   const pool=[...(snapshot?.plans??[]).map(plan=>({plan,group:'accepted',otherBlock:null as string|null})),...rejects.map(x=>({...x,group:'target_rejected'}))];
   for(const item of pool){
    const p=item.plan,key=split+':'+setup+':'+Math.floor(b.timestamp/86400000);
    if(seen.has(key))throw Error('duplicate_daily_opportunity');seen.add(key);
    const first=Math.ceil((asOf+10000)/60000)*60000,idx=(first-candles['1m'][0].timestamp)/60000;
    const bars=candles['1m'].slice(idx,idx+2880),dir=p.side==='long'?1:-1;
    const full=bars.length===2880&&bars.every((x,i)=>x.timestamp===first+i*60000);
    const crossed=bars.some(x=>dir*(x.close-p.targetBound)>0);
    const excursion=full?{favorableFraction:Math.max(0,...bars.map(x=>dir*((dir===1?x.high:x.low)-p.entry)/p.entry)),adverseFraction:Math.max(0,...bars.map(x=>-dir*((dir===1?x.low:x.high)-p.entry)/p.entry))}:null;
    for(const slip of [.001,.002])records.push({split,setup,asOf,key,group:item.group,otherBlock:item.otherBlock,plan:p,cost:slip===.001?'base':'stress',pivotCloseCrossed48h:crossed?true:full?false:null,excursion48h:excursion,
     outcome:evaluateOpportunityOutcome(p,bars,{submittedAt:asOf+10000,entryExpiresAt:asOf+45*60000,horizonAt:first+48*3600000,barMs:60000,feePerSide:.0005,slippageFraction:slip,funding:data.funding,pendingReview:{cadenceMs:300000,maxDriftFraction:.008}})});
   }
  }
 }
}
const summaries:any[]=[];
for(const split of ['train','independent-2023'])for(const setup of ['opening_range_breakout','opening_range_failure'])for(const group of ['accepted','target_rejected'])for(const cost of ['base','stress']){
 const all=records.filter(x=>x.split===split&&x.setup===setup&&x.group===group&&x.cost===cost),eligible=all.filter(x=>x.otherBlock===null),closed=eligible.filter(x=>x.outcome.status==='closed');
 summaries.push({split,setup,group,cost,observed:all.length,otherGuardBlocked:all.length-eligible.length,eligible:eligible.length,closed:closed.length,unfilled:eligible.filter(x=>x.outcome.status==='unfilled').length,censored:eligible.filter(x=>x.outcome.status==='censored').length,wins:closed.filter(x=>x.outcome.netUsd>0).length,meanNetUsd:closed.length?closed.reduce((a,x)=>a+x.outcome.netUsd,0)/closed.length:null,exitReasons:closed.reduce((a,x)=>(a[x.outcome.reason]=(a[x.outcome.reason]??0)+1,a),{}),pivotCrossed:eligible.filter(x=>x.pivotCloseCrossed48h===true).length,pivotUnknown:eligible.filter(x=>x.pivotCloseCrossed48h===null).length});
}
guard.verify();writeFileSync(out+'outcomes.json',JSON.stringify(records));
writeFileSync(out+'summary.json',JSON.stringify({datasets,policyHash:policy.hash,summaries,promotionEligible:false,sources:guard.initial,limitations:[
 'Post-hoc diagnosis on consumed TRAIN2025 and independent2023; not new validation.',
 'Fixed wallet, one opportunity per setup/day. Overlapping counterfactuals are NOT portfolio ROI; no account circuits or hourly selection.',
 'Only constructed structural_bounds plans captured; missing-target or quantity failures excluded.',
 'Original rejected plan geometry retained. Other guards checked by targetBound=TP solely for diagnosis; primary summaries exclude other-blocked plans.',
 'Pivot crossing uses minute closes over48h; excursions cover48h after submission regardless of fill/exit, not achievable trade MFE/MAE.',
 'Conservative SL-first ordering;10s delay,45m pending TTL,5m drift check,48h horizon; missing data censored.',
 'No AI calls or production changes. Descriptive results cannot authorize a filter change.'
 ]},null,2)+'\n');console.log(JSON.stringify(summaries));

import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {evaluateIctTargetEconomics,ictResearchGates,ictStructurePermits,selectIctResearchCandidates} from '../src/utils/ict-research';
import {isSilverWindow} from '../src/utils/ict-ote-silver-research';
import {computeExecutionRisk} from '../src/utils/execution-risk';
const out='../docs/audits/2026-09-20-ict-ote-silver/';
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const summary=read(out+'summary.json'),protocol=summary.protocol;
let baselineChecks=0,fillChecks=0,costChecks=0,structureChecks=0,riskChecks=0;
const cohorts:any[]=[];
for(const [path,hash] of Object.entries(summary.sourceHashes))assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),hash);
for(const split of Object.keys(protocol.splits)){
 const candidates=read(out+split+'-candidates.json');
 for(const variant of protocol.variants)for(const cost of ['base','stress']){
  const result=read(out+`${split}-${variant}-${cost}.json`),s=result.summary,gates=ictResearchGates(variant);
  const selected=(variant==='ote_cost_h1'?candidates.ote:variant==='silver_cost_h1'?candidates.silver:candidates.continuation) as import('../src/utils/ict-research').IctCandidate[];
  const byId=new Map(selected.map(c=>[c.id,c]));assert.equal(byId.size,selected.length);
  const submitted=new Map<string,any>();
  for(const e of result.events){
   if(e.type==='submitted'){
    assert(!submitted.has(e.plan.id));submitted.set(e.plan.id,e);
    const c=byId.get(e.plan.id)!;assert(c);assert.equal(e.time,c.confirmedAt+1);
    if(gates.h1){assert(ictStructurePermits(candidates.h1,c.side,c.confirmedAt,c.confirmedAt));structureChecks++;}
    if(gates.cost){assert(evaluateIctTargetEconomics({side:e.plan.side,entry:e.plan.entry,target:e.plan.takeProfit,quantity:e.plan.quantity,
     feePerSide:.0005,slippageFraction:.002,fundingReserveUsd:0,aiCostUsd:0}).allowed);costChecks++;}
   }
   if(e.type==='fill'){
    if(variant==='silver_cost_h1')assert(isSilverWindow(e.time));
    const submit=submitted.get(e.id),c=byId.get(e.id)!;assert(submit&&c);
    assert(e.time>=c.confirmedAt+60001&&e.time<submit.plan.expiresAt);assert(Math.abs(e.quantity/.001-Math.round(e.quantity/.001))<1e-7);fillChecks++;
    if(gates.h1){assert(ictStructurePermits(candidates.h1,c.side,c.confirmedAt,e.time-1));structureChecks++;}
    const priorNet=result.closes.filter((x:any)=>x.time<=e.time).reduce((sum:number,x:any)=>sum+x.netUsd,0);
    const balance=protocol.wallet+priorNet;
    const risk=computeExecutionRisk({entry:e.entry,stopLoss:submit.plan.stopLoss,quantity:e.quantity,balance,
     roundTripFeePercent:summary.admissionPolicy.feePercent,slippagePercent:.2});
    assert(risk.totalRiskUsd<=balance*.03+1e-8);riskChecks++;
   }
  }
  if(!s.open)assert(Math.abs(result.closes.reduce((n:number,c:any)=>n+c.netUsd,0)-s.netCashUsd)<1e-7);
  if(variant==='continuation_cost_h1'){
   const parent=read(`../docs/audits/2026-09-20-ict-implementation/${split}-${variant}-${cost}.json`);
   assert.deepEqual(s,parent.summary);assert.deepEqual(result.closes,parent.closes);baselineChecks++;
  }
 }
 for(const cost of ['base','stress'])for(const [comparator,candidate] of [
  ['continuation_cost_h1','ote_cost_h1'],['continuation_cost_h1','silver_cost_h1']]){
  const a=read(out+`${split}-${comparator}-${cost}.json`),b=read(out+`${split}-${candidate}-${cost}.json`);
  const left=new Map<string,any>(a.closes.map((c:any)=>[c.planId,c])),right=new Map<string,any>(b.closes.map((c:any)=>[c.planId,c]));
  const added=[...right.keys()].filter(k=>!left.has(k)),removed=[...left.keys()].filter(k=>!right.has(k)),shared=[...right.keys()].filter(k=>left.has(k));
  cohorts.push({split,cost,comparator,candidate,addedTrades:added.length,removedTrades:removed.length,sharedTrades:shared.length,
   addedNetUsd:added.reduce((n,k)=>n+right.get(k).netUsd,0),removedNetUsd:removed.reduce((n,k)=>n+left.get(k).netUsd,0),
   sharedDeltaNetUsd:shared.reduce((n,k)=>n+right.get(k).netUsd-left.get(k).netUsd,0),
   netCashDeltaUsd:b.summary.netCashUsd-a.summary.netCashUsd,bothFlat:!a.summary.open&&!b.summary.open});
 }
}
for(const c of cohorts)if(c.bothFlat)assert(Math.abs(c.addedNetUsd-c.removedNetUsd+c.sharedDeltaNetUsd-c.netCashDeltaUsd)<1e-7);
const report={scenarios:summary.summaries.length,baselineChecks,fillChecks,costChecks,structureChecks,riskChecks,
 sourceHashesVerified:true,cohorts,promotionEligible:false,note:'Checks count repeated cost/variant paths, not independent trades. All windows development/revalidation.'};
writeFileSync(out+'verification.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,cohorts:undefined},null,2));

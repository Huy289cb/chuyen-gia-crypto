/** One-minute execution screen shared by every core variant. Not a live AI replay. */
import { OpportunityPortfolio, type PortfolioCircuit, type PortfolioClose } from './opportunity-portfolio';
import type { AiOpportunityPolicy } from '../config/ai-opportunity-policy';
import { opportunityPlanBlock, type OpportunityPlan } from '../utils/ai-opportunity';
import { evaluateIctTargetEconomics, ictStructurePermits } from '../utils/ict-research';
import type { CoreCandidate, CoreStructure } from './core-ablation';
import {costCoveredStop} from './core-entry-exit';
import {cashBreakevenSl} from '../utils/breakeven-sl';
import {computeProfitProtectSl} from '../utils/profit-protect-sl';
export interface CoreReplayInput {
  bars: number[][]; funding: Array<{time:number;rate:number;markPrice:number}>;
  candidates: CoreCandidate[]; start:number; end:number; wallet:number;
  policy: AiOpportunityPolicy; circuit: PortfolioCircuit; slippage:number;
  h1?: CoreStructure;
  exitPolicy?: 'cost_protection_1r';
  runtimeProfitProtect?: 'fixed_buffer'|'cash_cost';
}
export interface CoreClose extends PortfolioClose {
  entryTime:number;side:string;reason:string;entry:number;stopLoss:number;takeProfit:number;
  mfeRUpperBound:number;maeRUpperBound:number;
}
export function validateCoreMinutes(bars:number[][],start:number,end:number):void {
  if(!(start<end)||!bars.length)throw Error('invalid_interval');
  let count=0,previous=start-60000;
  for(const b of bars){
    const [t,o,h,l,c,v]=b;if(t<start||t>=end)continue;
    if(!Number.isInteger(t)||t%60000||t!==previous+60000||![o,h,l,c].every(x=>Number.isFinite(x)&&x>0)||
      !Number.isFinite(v)||v<0||l>Math.min(o,c)||h<Math.max(o,c))throw Error('invalid_or_missing_minute');
    previous=t;count++;
  }
  if(count!==(end-start)/60000)throw Error('incomplete_interval');
}
export function replayCoreCandidates(input:CoreReplayInput) {
  const {bars,funding,candidates,start,end,wallet,policy,circuit,slippage,h1}=input;
  validateCoreMinutes(bars,start,end);
  for(let i=0;i<funding.length;i++){
    const f=funding[i];if(!Number.isFinite(f.time)||!Number.isFinite(f.rate)||!(f.markPrice>0)||(i>0&&f.time<=funding[i-1].time))throw Error('invalid_funding');
  }
  // Unknown historical funding is never silently priced as zero.
  if(!funding.some(f=>f.time<=start))throw Error('missing_initial_funding');
  const ledger=new OpportunityPortfolio(wallet,policy,circuit,.0005,slippage);
  const byTime=new Map<number,CoreCandidate[]>();
  for(const c of candidates){
    if(c.time<start||c.time>=end)continue;
    byTime.set(c.time,[...(byTime.get(c.time)??[]),c]);
  }
  const blocks:Record<string,number>={},events:Array<Record<string,unknown>>=[],closes:CoreClose[]=[];
  const count=(k:string)=>{blocks[k]=(blocks[k]??0)+1;};
  let fi=0,rate=NaN,submitted=0,fills=0,expired=0,ambiguous=0,submittedAt=0,mfe=0,mae=0,activeStop=NaN;
  const settle=(t:number,mark:number)=>{
    while(fi<funding.length&&funding[fi].time<=t){const f=funding[fi++];rate=f.rate;
      if(f.time>=start){ledger.advance(f.time,mark);ledger.fund(f.rate,f.markPrice);}}
  };
  const close=(price:number,time:number,reason:string)=>{
    const h=ledger.holding!;settle(time,price);ledger.advance(time,price);
    const details={entryTime:h.entryTime,side:h.plan.side,reason,entry:h.plan.entry,stopLoss:h.plan.stopLoss,takeProfit:h.plan.takeProfit,
      mfeRUpperBound:mfe,maeRUpperBound:mae};
    const row={...ledger.close(price),...details};closes.push(row);events.push({type:'close',...row});
  };
  let lastClose=0;
  for(const b of bars){
    const [t,o,hi,lo,c]=b;if(t<start||t>=end)continue;lastClose=c;
    settle(t,o);ledger.advance(t,o);
    if(ledger.pending&&t>=ledger.pending.expiresAt){ledger.cancel();expired++;}
    let intrabarEntry=false;
    if(ledger.pending&&t>=submittedAt+60000){
      const p=ledger.pending,d=p.side==='long'?1:-1;
      if(h1&&!ictStructurePermits(h1,p.side,submittedAt-1,t-1)){ledger.cancel();count('pending_structure_invalidated');}
      // The limit is already resting: a gap through SL cannot be cancelled retroactively.
      // It fills below and the holding branch exits at the adverse opening price.
      else if(d*(o-p.takeProfit)>=0){ledger.cancel();count('invalidated_before_fill');}
      else if(d===1?lo<=p.entry-.1:hi>=p.entry+.1){
        const block=opportunityPlanBlock(p,{...ledger.finance(rate),allowed:true},policy,t);
        if(block){ledger.cancel();count('fill_'+block);}
        else{intrabarEntry=d*(o-p.entry)>0;ledger.fill();fills++;mfe=mae=0;activeStop=p.stopLoss;events.push({type:'fill',time:t,id:p.id});}
      }else if(d===1?hi>=p.takeProfit:lo<=p.takeProfit){ledger.cancel();count('target_consumed_before_fill');}
    }
    if(ledger.holding){
      const p=ledger.holding.plan,d=p.side==='long'?1:-1,dist=Math.abs(p.entry-p.stopLoss);
      // Bar extrema are bounds, never asserted to have occurred before the exit/after the entry.
      mfe=Math.max(mfe,d*((d===1?hi:lo)-p.entry)/dist);mae=Math.max(mae,-d*((d===1?lo:hi)-p.entry)/dist);
      const stop=d===1?lo<=activeStop:hi>=activeStop,target=d===1?hi>=p.takeProfit:lo<=p.takeProfit;
      if(d*(o-activeStop)<=0)close(o,t,'gap_stop');
      else if(!intrabarEntry&&d*(o-p.takeProfit)>=0)close(p.takeProfit,t,'target');
      else if(stop){if(target||intrabarEntry)ambiguous++;close(activeStop,t+60000,target||intrabarEntry?'ambiguous_stop_first':activeStop!==p.stopLoss?'cost_protection_stop':'stop');}
      else if(target&&!intrabarEntry)close(p.takeProfit,t+60000,'target');
      else if(target&&intrabarEntry)ambiguous++;
    }
    settle(t+60000,c);ledger.advance(t+60000,c);
    if(input.runtimeProfitProtect&&ledger.holding){
      const h=ledger.holding,p=h.plan;
      const costSl=cashBreakevenSl({side:p.side,entry:p.entry,quantity:p.quantity,entryCostsUsd:h.entryFee+h.entrySlip,
        fundingPaidUsd:h.funding,exitFeeFraction:.0005,exitSlippageFraction:slippage/2,tickSize:.1});
      if(costSl===null)throw Error('invalid_protection_costs');
      const plan=computeProfitProtectSl({side:p.side,entry:p.entry,mark:c,currentSl:activeStop,initialRisk:Math.abs(p.entry-p.stopLoss),
        ageMinutes:(t+60000-h.entryTime)/60000,beAtR:2,trailActivatePct:2.5,trailDistancePct:.55,minSlMovePct:.05,minAgeMinutes:15,
        timeStopHours:0,beFeeBufferPct:.08,cashBreakevenSl:input.runtimeProfitProtect==='cash_cost'?costSl:undefined});
      if(plan.action!=='none'){
        activeStop=plan.newSl;events.push({type:'protect_stop',time:t+60000,id:p.id,stopLoss:activeStop,action:plan.action});
      }
    }
    if(input.exitPolicy==='cost_protection_1r'&&ledger.holding&&(t+60000)%300000===0){
      const h=ledger.holding,p=h.plan,d=p.side==='long'?1:-1;
      if(d*(c-p.entry)>=Math.abs(p.entry-p.stopLoss)){
        const proposed=costCoveredStop({side:p.side,entry:p.entry,quantity:p.quantity,entryFee:h.entryFee,
          entrySlip:h.entrySlip,funding:h.funding,feePerSide:.0005,roundTripSlippage:slippage});
        // The closed 5m confirmation can only amend the stop for a later minute.
        if(d*(proposed-activeStop)>0&&d*(c-proposed)>.1&&d*(p.takeProfit-proposed)>.1){
          activeStop=proposed;events.push({type:'protect_stop',time:t+60000,id:p.id,stopLoss:activeStop});
        }
      }
    }
    for(const candidate of byTime.get(t+60000)??[]){
      const block=ledger.block();if(block){count(block);continue;}
      const finance=ledger.finance(rate),distance=Math.abs(candidate.entry-candidate.stopLoss);
      const desired=Math.min(finance.remainingExposureUsd,finance.balance*policy.targetPercent/100/(distance/candidate.entry));
      const quantity=Math.max(.001,Math.ceil(50/candidate.entry/.001-1e-9)*.001,Math.floor(desired/candidate.entry/.001+1e-9)*.001);
      const plan:OpportunityPlan={...candidate,symbol:'BTC',timeframe:'15m',setup:`core:${candidate.timeframe}:${candidate.setup}`,
        quantity,riskUsd:quantity*distance,rr:Math.abs(candidate.takeProfit-candidate.entry)/distance,
        invalidation:candidate.stopLoss,expiresAt:t+60000+3600000,evidenceIds:[candidate.id]};
      // Generic portfolio's 15m scope is an adapter field only; source TF remains in candidate and setup.
      const economics=evaluateIctTargetEconomics({side:plan.side,entry:plan.entry,target:plan.takeProfit,quantity,
        feePerSide:.0005,slippageFraction:.002,fundingReserveUsd:0,aiCostUsd:0});
      const reject=!economics.allowed?'target_cost':ledger.reserve(plan,rate);
      if(reject)count(reject);else{submitted++;submittedAt=t+60000;events.push({type:'submit',time:submittedAt,plan});}
    }
  }
  if(ledger.holding)close(lastClose,end,'end_liquidation');
  if(ledger.pending){ledger.cancel();count('end_cancel');}
  const net=closes.reduce((s,c)=>s+c.netUsd,0);
  if(Math.abs(ledger.wallet-wallet-net)>1e-7)throw Error('cash_reconciliation');
  const wins=closes.filter(c=>c.netUsd>0),losses=closes.filter(c=>c.netUsd<0);
  return {summary:{candidates:candidates.length,submitted,fills,expired,ambiguous,trades:closes.length,wins:wins.length,losses:losses.length,
    netUsd:net,roiPercent:net/wallet*100,expectancy:closes.length?net/closes.length:null,
    profitFactor:losses.length?wins.reduce((s,c)=>s+c.netUsd,0)/-losses.reduce((s,c)=>s+c.netUsd,0):null,
    fees:closes.reduce((s,c)=>s+c.feesUsd,0),funding:closes.reduce((s,c)=>s+c.fundingUsd,0),slippage:closes.reduce((s,c)=>s+c.slippageUsd,0),
    maxDrawdownPercent:ledger.maxDrawdownPercent,blocks},closes,events};
}
export function compareCoreCohorts(baseline:CoreClose[],candidate:CoreClose[]) {
  const a=new Map(baseline.map(t=>[t.planId,t])),b=new Map(candidate.map(t=>[t.planId,t]));
  if(a.size!==baseline.length||b.size!==candidate.length)throw Error('duplicate_trade_id');
  const added=candidate.filter(t=>!a.has(t.planId)),removed=baseline.filter(t=>!b.has(t.planId));
  const sum=(rows:CoreClose[])=>rows.reduce((s,t)=>s+t.netUsd,0);
  const commonDelta=candidate.filter(t=>a.has(t.planId)).reduce((s,t)=>s+t.netUsd-a.get(t.planId)!.netUsd,0);
  const delta=sum(candidate)-sum(baseline);
  if(Math.abs(delta-(sum(added)-sum(removed)+commonDelta))>1e-8)throw Error('cohort_reconciliation');
  return {added:added.length,removed:removed.length,addedNet:sum(added),removedNet:sum(removed),commonDelta,delta,
    addedExpectancy:added.length?sum(added)/added.length:null};
}

import {parseOpportunityChoice,type OpportunitySnapshot,type OpportunityCandle} from '../utils/ai-opportunity';
import {evaluateOpportunityOutcome,type OpportunityOutcome} from './opportunity-outcome';
import type {ReplayFunding} from './replay-account';

export interface ProspectiveReviewRecord {
 snapshot:string;receivedAt:number;costUsd:number|null;rawContent?:string;reason?:string;
}
export function evaluateProspectivePair(input:{
 snapshotKey:string;snapshot:OpportunitySnapshot;capturedAt:number;review:ProspectiveReviewRecord|null;
 bars:OpportunityCandle[];funding:ReplayFunding[];fundingCoveredThrough:number;observedThrough:number;
 slippageFraction:number;
}){
 const {snapshot:s,review:r}=input;
 const none=(reason:string)=>({paired:false,reason,allPlans:[] as OpportunityOutcome[],bNetUsd:null as number|null,
  cGrossNetUsd:null as number|null,cAfterAiCostUsd:null as number|null,deltaCMinusBUsd:null as number|null,
  aiCostUsd:r?.costUsd??null,decision:null as string|null});
 if(!r)return none('awaiting_response');
 if(!Number.isFinite(s.asOf)||!Number.isFinite(s.expiresAt))return none('invalid_snapshot_time');
 if(r.snapshot!==input.snapshotKey||!Number.isFinite(r.receivedAt)||!Number.isFinite(input.capturedAt)||
  input.capturedAt<s.asOf||r.receivedAt<input.capturedAt)return none('invalid_response_link_or_time');
 if(r.receivedAt-s.asOf>120000||r.receivedAt>=s.expiresAt)return none('stale_response');
 if(!s.plans.length||!s.plans.some(p=>p.id===s.deterministicPlanId))return none('invalid_candidate_pool');
 if(!Number.isFinite(input.observedThrough)||r.receivedAt>input.observedThrough)return none('future_response');
 const choice=r.rawContent?parseOpportunityChoice(r.rawContent,s):null;
 const submittedAt=r.receivedAt,first=Math.ceil(submittedAt/60000)*60000;
 const horizonAt=first+48*3600000;
 const available=Math.min(input.observedThrough,horizonAt);
 // Unknown or incomplete funding is not silently represented as free carry.
 if(!Number.isFinite(input.fundingCoveredThrough)||input.fundingCoveredThrough<available)return none('incomplete_funding_coverage');
 const bars=input.bars.filter(b=>b.timestamp>=first&&b.timestamp+60000<=available);
 const allPlans=s.plans.map(p=>evaluateOpportunityOutcome(p,bars,{submittedAt,entryExpiresAt:Math.ceil((submittedAt+45*60000)/300000)*300000,
  horizonAt,barMs:60000,feePerSide:.0005,slippageFraction:input.slippageFraction,funding:input.funding,
  pendingReview:{cadenceMs:300000,maxDriftFraction:.008}}));
 const net=(id:string|null):number|null=>{
  if(id===null)return 0;
  const result=allPlans.find(p=>p.planId===id);
  return result?.status==='closed'?result.netUsd:result?.status==='unfilled'?0:null;
 };
 const bNetUsd=net(s.deterministicPlanId),cGrossNetUsd=net(choice?.decision==='take'?choice.plan_id:null);
 const costKnown=typeof r.costUsd==='number'&&Number.isFinite(r.costUsd)&&r.costUsd>=0;
 const cAfterAiCostUsd=costKnown&&cGrossNetUsd!==null?cGrossNetUsd-r.costUsd!:null;
 return {paired:true,reason:choice?'evaluated_choice':'failed_closed_abstention',allPlans,bNetUsd,cGrossNetUsd,cAfterAiCostUsd,
  deltaCMinusBUsd:bNetUsd!==null&&cAfterAiCostUsd!==null?cAfterAiCostUsd-bNetUsd:null,
  aiCostUsd:costKnown?r.costUsd:null,decision:choice?.decision??'invalid_or_failed',submittedAt,
  completeSelectedPair:bNetUsd!==null&&cGrossNetUsd!==null,
  limitations:['Matched response-time counterfactuals isolate choice, not full native-B latency advantage.',
   'Fixed paper wallet; outcomes may overlap and are NOT portfolio ROI.','Minute limit-touch, SL-first,45m/5m TTL and drift approximation; no full exchange protection parity.']};
}

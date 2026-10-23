import {analyzeCausalSetupGate,causalScoringEnabled} from '../analyzers/causal-setup-gate.analyzer';
import {analyzeSetupGate} from '../analyzers/setup-gate.analyzer';
import {validateOptimizedRangeRetest,type RetestDispatchContext} from './adaptive-retest-dispatch';
import {revalidateCausalPlan,type CausalPlanEvidence} from './causal-plan-evidence';
import type {CausalPlanContract} from './causal-plan-contract';
import {getRiskPolicy} from '../config/risk-policy';
import {evaluateSetupGradePlaybookFilter} from '../config/v3-entry-policy';
import {getAdaptiveSetupMode,isRangeSweepReclaimEnabled} from '../config/adaptive-setup-policy';
import {getTransitionRetestTolerancePct} from '../config/transition-retest-policy';
import {classifyStructureBias,type StructureBias} from './structure-bias';
import type {H1Bar} from './h1-causal-plan';
import {h2Candidates} from './h2-causal-plan';
import {getV3StructureBiasStrength} from '../config/v3-structure-bias-policy';

export const CAUSAL_RANGE_PERMISSION_VERSION='existing-long-range-v1';
export function causalRangePermissionEnabled():boolean {
  return causalScoringEnabled()&&process.env.CAUSAL_PERMISSION_VERSION===CAUSAL_RANGE_PERMISSION_VERSION;
}
export interface CausalRangePermission {
  pass:boolean;reason:string;version:typeof CAUSAL_RANGE_PERMISSION_VERSION;
  planHash:string;structureBias?:StructureBias;legacySweepGrade?:string;
}
/** Reuses the configured long5m range predicate with independently measured legacy evidence. */
export async function evaluateCausalRangePermission(input:{plan:CausalPlanContract;evidence:CausalPlanEvidence|undefined;
  now:number;htf1h:{fresh:boolean;regime:string};structure:H1Bar[]}):Promise<CausalRangePermission> {
  const {plan,evidence,now}=input;
  const result=(pass:boolean,reason:string,extra:Partial<CausalRangePermission>={}):CausalRangePermission=>({pass,reason,version:CAUSAL_RANGE_PERMISSION_VERSION,planHash:plan.hash,...extra});
  if(!causalRangePermissionEnabled()||plan.mechanism!=='H2'||plan.side!=='long'||plan.timeframe!=='5m'||
    getAdaptiveSetupMode()!=='live'||!isRangeSweepReclaimEnabled())return result(false,'causal_existing_range_not_enabled_or_eligible');
  const block=revalidateCausalPlan(plan,evidence,now);if(block||!evidence)return result(false,block??'causal_evidence_missing');
  const quality=analyzeCausalSetupGate({symbol:'BTC',timeframe:'5m',candles:evidence.bars.five.slice(-100)},plan,evidence,now),policy=getRiskPolicy();
  if(quality.confidence<policy.minSignalConfidence||!evaluateSetupGradePlaybookFilter({grade:quality.grade,confidence:quality.confidence,playbookKey:quality.playbookKey}).pass)
    return result(false,'causal_existing_range_quality_blocked');
  if(Math.abs(plan.target-plan.entry)/Math.abs(plan.entry-plan.stop)<plan.minRr)return result(false,'causal_existing_range_rr_blocked');
  const structure=input.structure;
  if(structure.length<40||structure.some((b,i)=>![b.timestamp,b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)||
    b.timestamp%14400000!==0||b.timestamp+14400000+5000>now||b.volume<0||Math.min(b.open,b.low,b.high,b.close)<=0||
    b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close)||(i>0&&b.timestamp-structure[i-1].timestamp!==14400000))||
    structure.at(-1)!.timestamp!==Math.floor((now-5000)/14400000)*14400000-14400000)return result(false,'causal_existing_range_structure_history_invalid');
  const hour=evidence.bars.hour.filter(b=>b.timestamp+3600000+5000<=plan.knownAt);
  const five=evidence.bars.five.filter(b=>b.timestamp+300000+5000<=plan.knownAt);
  if(five.length<100)return result(false,'causal_existing_range_sweep_history_insufficient');
  const candidate=h2Candidates(hour,five,plan.knownAt).find(c=>c.id===plan.setupId);
  if(!candidate)return result(false,'causal_existing_range_candidate_missing');
  const latest=evidence.bars.five.at(-1)!,tolerance=getTransitionRetestTolerancePct()/100;
  if(latest.timestamp<plan.knownAt||latest.low>candidate.low*(1+tolerance)||latest.close<candidate.low)return result(false,'causal_existing_range_retest_missing');
  const legacy=await analyzeSetupGate({symbol:'BTC',timeframe:'5m',candles:five.slice(-100)});
  const context:RetestDispatchContext={candidateKey:plan.setupId,candidateKind:'range_sweep_reclaim',side:'long',boundaryPrice:candidate.low,
    breakoutBarKey:String(plan.knownAt-305000),confirmedEntryPrice:plan.entry,minRr:plan.minRr,rangeLow:candidate.low,rangeHigh:candidate.high};
  const structureBias=classifyStructureBias(structure,{strength:getV3StructureBiasStrength()}).bias;
  const validation=validateOptimizedRangeRetest({context,timeframe:'5m',signalResult:{setupResult:legacy,pass:false,shouldCallGroq:false,isDuplicate:false,reason:'original closed sweep evidence'},htf1h:input.htf1h,structureBias});
  return result(validation.pass,validation.reason,{structureBias,legacySweepGrade:legacy.grade});
}

import {revalidateCausalPlan,type CausalPlanEvidence} from '../utils/causal-plan-evidence';
import type {CausalPlanContract} from '../utils/causal-plan-contract';
import {computeRegimeEvidence} from './market-regime.analyzer';
import {getSignalGateWindows} from '../config/signal-gate-windows';
import type {SetupGateInput,SetupGateResult} from './setup-gate.analyzer';
import type {PlaybookEvidence,SetupGateEvidence} from './setup-gate.types';
import {formatSetupGateDetail} from '../utils/setup-gate-evidence';

export const CAUSAL_SCORING_VERSION='rejection-volume-v1';
export function causalScoringEnabled():boolean {
  return process.env.CAUSAL_OPPORTUNITY_RESEARCH_ENABLED==='true'&&
    process.env.CAUSAL_SETUP_SCORING_VERSION===CAUSAL_SCORING_VERSION;
}

/** Registered candle-quality rule. `confidence` is a rule score, not win probability. */
export function analyzeCausalSetupGate(input:SetupGateInput,plan:CausalPlanContract,evidence:CausalPlanEvidence|undefined,now:number):SetupGateResult {
  const block=revalidateCausalPlan(plan,evidence,now);
  const regime=computeRegimeEvidence(input.candles,{timeframe:input.timeframe,regimeBars:getSignalGateWindows(input.timeframe).regimeBars});
  const playbook=plan.mechanism==='H1'?'h1_acceptance_retest':'h2_range_sweep_reclaim';
  const metrics:PlaybookEvidence['metrics']={detectorVersion:CAUSAL_SCORING_VERSION,confidenceKind:'rule_quality_not_probability',setupId:plan.setupId,planHash:plan.hash,side:plan.side};
  const child=plan.mechanism==='H1'?'fifteen':'five';
  const bars=evidence?.bars[child]??[];
  // H2 rejection belongs to the original sweep, not the later confirmation candle.
  const open=(plan.mechanism==='H1'?now:plan.knownAt)-(plan.mechanism==='H1'?900000:300000)-5000;
  const index=bars.findIndex(b=>b.timestamp===open),bar=bars[index],confirmation=bars.at(-1);
  let grade:SetupGateResult['grade']='D',score=0,reason=block??'causal_quality_history_insufficient';
  // The local scan input must be the actual same child prefix, not unrelated caller candles.
  const matchesInput=input.symbol===plan.symbol&&input.timeframe===plan.timeframe&&input.candles.length>=50&&
    input.candles.length<=bars.length&&input.candles.every((b,i)=>{
      const expected=bars[bars.length-input.candles.length+i];
      return expected&&['timestamp','open','high','low','close','volume'].every(k=>b[k as keyof typeof b]===expected[k as keyof typeof expected]);
    });
  if(!block&&!matchesInput)reason='causal_quality_scan_prefix_mismatch';
  if(!block&&matchesInput&&index>=20&&bar&&confirmation){
    const range=bar.high-bar.low,body=range>0?Math.abs(bar.close-bar.open)/range:0;
    const wick=range>0?(plan.side==='long'?Math.min(bar.open,bar.close)-bar.low:bar.high-Math.max(bar.open,bar.close))/range:0;
    const mean=bars.slice(index-20,index).reduce((sum,b)=>sum+b.volume,0)/20;
    const volumeRatio=mean>0?bar.volume/mean:0,d=plan.side==='long'?1:-1;
    const directional=d*(bar.close-bar.open)>0&&d*(confirmation.close-confirmation.open)>0;
    Object.assign(metrics,{qualityOpen:open,confirmationOpen:confirmation.timestamp,rejectionWick:wick,bodyRatio:body,prior20MeanVolume:mean,volumeRatio,directional,scoreFormula:'min(1,wick/0.6,body/0.2,volumeRatio/2)'});
    if(range>0&&mean>0&&directional){
      score=Math.min(1,wick/.6,body/.2,volumeRatio/2);
      grade=wick>.6&&body>.2&&volumeRatio>1.5?'A':wick>.5&&body>.15&&volumeRatio>1?'B':'C';
      reason=`${CAUSAL_SCORING_VERSION}: candle rejection grade ${grade}; rule quality ${score.toFixed(4)} (not win probability)`;
    }else reason='causal_quality_direction_or_reference_invalid';
  }
  if(regime.regime==='chop'){grade='D';score=0;reason='causal_quality_chop_veto';}
  const setupEvidence:SetupGateEvidence={symbol:input.symbol,timeframe:input.timeframe,candleCount:input.candles.length,lastCandleTime:input.candles.at(-1)?.timestamp??null,price:input.candles.at(-1)?.close??0,regime,
    playbooks:[{playbook,detected:!block&&matchesInput&&grade!=='D',grade,summary:reason,metrics}]};
  return {playbookKey:playbook,grade,confidence:score,confidenceKind:'rule_quality',regime:regime.regime,reason,evidence:setupEvidence,detailReason:formatSetupGateDetail(setupEvidence)};
}

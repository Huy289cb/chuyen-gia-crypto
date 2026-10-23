import {causalPlanBlock, type CausalPlanContract} from './causal-plan-contract';
import {h1Candidates,h1RetestPlan,type H1Bar} from './h1-causal-plan';
import {h2Candidates,h2ReclaimPlan} from './h2-causal-plan';

export interface CausalPlanEvidence {
  at:number;
  bars:{hour:H1Bar[];five:H1Bar[];fifteen:H1Bar[];fourHour:H1Bar[]};
}
const durations={hour:3600000,five:300000,fifteen:900000,fourHour:14400000};
/** Candle-supported identity/geometry, never a grade, confidence or order authorization. */
export function revalidateCausalPlan(plan:CausalPlanContract,evidence:CausalPlanEvidence|undefined,now:number):string|null {
  const contractBlock=causalPlanBlock(plan,plan.symbol,plan.timeframe,now);
  if(contractBlock)return contractBlock;
  if(!evidence||evidence.at!==now)return 'causal_evidence_missing_or_clock_mismatch';
  const keys=plan.mechanism==='H1'?['hour','fifteen','fourHour'] as const:['hour','five'] as const;
  for(const key of keys){
    const bars=evidence.bars?.[key],duration=durations[key];
    if(!Array.isArray(bars)||bars.length===0)return 'causal_evidence_history_missing';
    for(let i=0;i<bars.length;i++){
      const b=bars[i];
      if(!b||![b.timestamp,b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)||
        b.timestamp%duration!==0||Math.min(b.open,b.high,b.low,b.close)<=0||b.volume<0||
        b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close)||b.low>b.high||
        b.timestamp+duration+5000>now||(i>0&&b.timestamp-bars[i-1].timestamp!==duration))return 'causal_evidence_invalid_history';
    }
    if(bars.at(-1)!.timestamp!==Math.floor((now-5000)/duration)*duration-duration)return 'causal_evidence_stale_history';
  }
  const prefix=(key:keyof typeof durations,at:number)=>evidence.bars[key].filter(b=>b.timestamp+durations[key]+5000<=at);
  if(prefix('hour',plan.knownAt).length<100)return 'causal_evidence_history_insufficient';
  const child=plan.mechanism==='H1'?'fifteen':'five',cadence=durations[child];
  if(prefix(child,plan.knownAt).length<15||
    (plan.mechanism==='H1'&&prefix('fourHour',plan.knownAt).length<5))return 'causal_evidence_history_insufficient';
  if((plan.knownAt-5000)%(plan.mechanism==='H1'?3600000:300000)!==0||
    (now-5000)%cadence!==0)return 'causal_evidence_cadence_mismatch';
  const candidates=plan.mechanism==='H1'
    ?h1Candidates(prefix('hour',plan.knownAt),plan.knownAt)
    :h2Candidates(prefix('hour',plan.knownAt),prefix('five',plan.knownAt),plan.knownAt);
  const candidate=candidates.find(c=>c.id===plan.setupId&&c.side===plan.side&&c.knownAt===plan.knownAt&&c.expiresAt===plan.expiresAt);
  if(!candidate)return 'causal_evidence_candidate_mismatch';
  for(let at=Math.ceil((plan.knownAt-5000)/cadence)*cadence+5000;at<=now;at+=cadence){
    const outcome=plan.mechanism==='H1'
      ?h1RetestPlan(candidate as ReturnType<typeof h1Candidates>[number],prefix('fifteen',at),prefix('fourHour',at),at)
      :h2ReclaimPlan(candidate as ReturnType<typeof h2Candidates>[number],prefix('five',at),at);
    if(outcome.status==='waiting')continue;
    if(at!==now||outcome.status!=='plan')return 'causal_evidence_not_first_plan';
    const stop=plan.side==='long'?Math.floor(outcome.stop*10)/10:Math.ceil(outcome.stop*10)/10;
    if(outcome.entry!==plan.entry||stop!==plan.stop||outcome.target!==plan.target||outcome.invalidation!==plan.invalidation)return 'causal_evidence_geometry_mismatch';
    return null;
  }
  return 'causal_evidence_plan_missing';
}

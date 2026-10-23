import {GroqDispatchService,type GroqDispatchInput} from './groq-dispatch.service';
import {executeV3Trade} from './v3-trade-execution.service';
import {causalPlanBlock,type CausalPlanContract} from '../utils/causal-plan-contract';
import {getMethodConfig} from '../config/methods';
import {recordEntryStage} from '../utils/entry-trace';

/** Research-only caller of actual dispatch/executor. Does not manufacture signal grades.
 * Inventory persistence/claim must precede delivery; uncertain executions must not be retried.
 */
export async function reviewAndExecuteCausalPlan(input:GroqDispatchInput&{causalPlan:CausalPlanContract}) {
 if(process.env.CAUSAL_OPPORTUNITY_RESEARCH_ENABLED!=='true')return {decision:'no_trade',reason:'causal_research_disabled'};
 const plan:CausalPlanContract=JSON.parse(JSON.stringify(input.causalPlan));
 const methodId=input.method_id??'kim_nghia';
 const block=causalPlanBlock(plan,input.symbol,input.timeframe,Date.now());
 if(block||getMethodConfig(methodId).autoEntry.minRRRatio!==plan.minRr)return {decision:'no_trade',reason:block??'causal_research_rr_policy_mismatch'};
 const review=await new GroqDispatchService().dispatch({...input,causalPlan:plan});
 if(review.decision!=='trade'||!review.analysis)return {review,decision:'no_trade',reason:review.reason};
 // The actual executor rechecks immutable geometry, time validity and every account guard.
 await recordEntryStage('causal_execution_requested',{setup_id:plan.setupId,plan_hash:plan.hash});
 const execution=await executeV3Trade({symbol:input.symbol,timeframe:input.timeframe,methodId,
  analysis:review.analysis,decisionRecordId:review.decisionRecordId,trace:review.trace,
  requiredMinRr:plan.minRr,causalPlan:plan});
 return {review,execution,decision:execution.success?'pending':'no_trade',reason:execution.reason};
}

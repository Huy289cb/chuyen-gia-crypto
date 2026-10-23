export interface AccountGuardCompletionInput {
 circuitAllowed:boolean;circuitReason:string;startEquity:number|null|undefined;
 accountEquity:number|undefined;dailyLossLimitPercent:number;dailyLossUsd:number;
}
/** Original final gate and daily budget. Prior guards and side effects belong to caller. */
export function completeAccountGuard(i:AccountGuardCompletionInput){
 if(!i.circuitAllowed)return {allowed:false,reason:i.circuitReason};
 return {allowed:true,reason:'Account trade guard passed',remainingDailyRiskUsd:Math.max(0,(i.startEquity??i.accountEquity)!*i.dailyLossLimitPercent/100-i.dailyLossUsd)};
}
export function replayAccountGuardCompletion(record:unknown,knownAt:number,asOf:number){
 const unknown=(reason:string)=>({status:'unknown' as const,reason});
 if(!record||typeof record!=='object'||Array.isArray(record))return unknown('missing_completion');
 const d=record as Record<string,any>,i=d.input,observed=typeof d.observed_at==='string'?Date.parse(d.observed_at):NaN;
 if(d.schema!=='account-guard-completion-v1'||![observed,knownAt,asOf].every(Number.isFinite)||observed>knownAt||knownAt>asOf)return unknown('invalid_completion_clock');
 if(!i||typeof i.circuitAllowed!=='boolean'||typeof i.circuitReason!=='string')return unknown('missing_circuit_decision');
 // JSON erases nonfinite numbers to null; reject lost financial output
 // before a nullish fallback could reconstruct a different budget.
 if(i.circuitAllowed&&(typeof d.decision?.remainingDailyRiskUsd!=='number'||!Number.isFinite(d.decision.remainingDailyRiskUsd)))return unknown('missing_recorded_daily_budget');
 const basis=i.startEquity??i.accountEquity;
 if(i.circuitAllowed&&![basis,i.dailyLossLimitPercent,i.dailyLossUsd].every(v=>typeof v==='number'&&Number.isFinite(v)))return unknown('missing_daily_budget_inputs');
 const expected=completeAccountGuard(i);const matches_recorded=!!d.decision&&['allowed','reason','remainingDailyRiskUsd'].every(k=>d.decision[k]===expected[k as keyof typeof expected]);
 return {status:'evaluated' as const,matches_recorded,expected_decision:expected,prior_guard_coverage:'not_established' as const};
}

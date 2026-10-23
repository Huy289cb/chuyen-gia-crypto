import {evaluateAccountInitialGuard} from './account-initial-guard';
export function replayRecordedAccountInitialDecision(record:unknown,knownAt:number,asOf:number){
 const unknown=(reason:string)=>({status:'unknown' as const,reason});
 if(!record||typeof record!=='object'||Array.isArray(record))return unknown('missing_record');
 const d=record as Record<string,any>,i=d.input;const clock=(v:unknown)=>typeof v==='string'?Date.parse(v):NaN;
 const start=clock(d.read_started_at),end=clock(d.read_returned_at),evaluated=clock(d.evaluated_at);
 if(d.schema!=='account-initial-guard-v1'||![start,end,evaluated,knownAt,asOf].every(Number.isFinite)||start>end||end>evaluated||evaluated>knownAt||knownAt>asOf)return unknown('invalid_knowledge_clock');
 if(!i||clock(i.now)!==evaluated||!(i.cooldownUntil===null||Number.isFinite(clock(i.cooldownUntil)))||!(i.consecutiveLosses===null||Number.isSafeInteger(i.consecutiveLosses)&&i.consecutiveLosses>=0)||!Number.isSafeInteger(i.maxConsecutiveLosses)||i.maxConsecutiveLosses<0||!(i.protectiveBlock===null||typeof i.protectiveBlock?.reason==='string'))return unknown('invalid_resolved_input');
 const expected=evaluateAccountInitialGuard({...i,now:new Date(evaluated),cooldownUntil:i.cooldownUntil===null?null:new Date(i.cooldownUntil)});
 const matches_recorded=!!d.decision&&['allowed','reason','clearExpiredCooldown'].every(k=>d.decision[k]===expected[k as keyof typeof expected]);
 return {status:'evaluated' as const,matches_recorded,expected_decision:expected,full_account_guard:'not_established' as const};
}

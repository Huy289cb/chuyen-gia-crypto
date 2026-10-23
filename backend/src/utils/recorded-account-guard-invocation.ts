import {replayRecordedAccountInitialDecision as initial} from './recorded-account-initial-decision';
import {replayLossStreakCooldown as streak} from './loss-streak-cooldown-decision';
import {replayRecordedAccountCircuitDecision as circuit} from './recorded-account-circuit-decision';
import {replayAccountGuardCompletion as completion} from './account-guard-completion';
export interface KnownGuardEvent{known_at:number;data:Record<string,any>}
/** Ordered journal observations, never guessed joins from legacy trace/account clocks. */
export function replayRecordedAccountGuardInvocation(rows:KnownGuardEvent[],asOf:number){
 const unknown=(reason:string)=>({status:'unknown' as const,reason});
 if(!rows.length||!Number.isFinite(asOf))return unknown('missing_invocation');
 const head=rows[0].data,id=head.guard_invocation_id,account=head.guard_account_id,trace=head.trace_id;
 if(typeof id!=='string'||!id||!Number.isSafeInteger(account)||typeof trace!=='string'||!trace)return unknown('missing_identity');
 const stages=new Map<string,KnownGuardEvent>();let last=-Infinity;
 for(const r of rows){const d=r.data;if(!Number.isFinite(r.known_at)||r.known_at>asOf||r.known_at<last)return unknown('availability_clock');last=r.known_at;
  if(d.guard_invocation_id!==id||d.guard_account_id!==account||d.account_id!==account||d.trace_id!==trace)return unknown('identity_conflict');
  if(typeof d.stage!=='string'||stages.has(d.stage))return unknown('duplicate_stage');stages.set(d.stage,r);
 }
 const start=stages.get('account_guard_invocation_started'),end=stages.get('account_guard_invocation_finished');
 const clock=(v:unknown)=>typeof v==='string'?Date.parse(v):NaN;
 if(!start||!end||rows[0]!==start||rows.at(-1)!==end||[start,end].some(r=>r.data.invocation_schema!=='account-guard-invocation-v1'))return unknown('boundaries');
 const a=clock(start.data.started_at),b=clock(end.data.finished_at);
 if(!Number.isFinite(a)||!Number.isFinite(b)||a>b||a>start.known_at||b>end.known_at||typeof start.data.exchange_loss_streak_required!=='boolean')return unknown('boundary_clock');
 if(end.data.outcome!=='returned')return unknown('thrown_or_missing_outcome');
 const i=stages.get('account_guard_initial_evaluated'),s=stages.get('account_loss_streak_evaluated'),c=stages.get('account_circuit_decision_evaluated'),f=stages.get('account_guard_completed');
 if(!i)return unknown('missing_initial');
 const reached=[i,s,c,f].filter((r):r is KnownGuardEvent=>!!r);if(reached.some((r,n)=>n>0&&rows.indexOf(r)<=rows.indexOf(reached[n-1])))return unknown('stage_order');const ir=initial(i.data.initial_guard,i.known_at,asOf);
 if(ir.status!=='evaluated'||!ir.matches_recorded)return unknown('initial_unknown_or_mismatch');
 if(clock(i.data.initial_guard.read_started_at)<a||clock(i.data.initial_guard.evaluated_at)>b)return unknown('initial_clock');
 let expected:any={allowed:false,reason:ir.expected_decision.reason},veto=!ir.expected_decision.allowed;
 if(veto&&s)return unknown('streak_after_initial_veto');
 if(!veto&&start.data.exchange_loss_streak_required){if(!s)return unknown('missing_streak');const sr=streak(s.data.streak_decision?.input);
  if(sr.status!=='evaluated'||JSON.stringify(sr.decision)!==JSON.stringify(s.data.streak_decision.decision))return unknown('streak_unknown_or_mismatch');
  const input=s.data.streak_decision.input;if([input.checkedAtMs,input.remainingAtMs].some(t=>t!==null&&(t<a||t>b||t>s.known_at)))return unknown('streak_clock');veto=!sr.decision.allowed;expected={allowed:false,reason:sr.decision.reason};
 }else if(!veto&&s)return unknown('unexpected_streak');
 if(veto){if(c||f)return unknown('stages_after_veto');}
 else{if(!c||!f)return unknown('missing_circuit_or_completion');const cr=circuit(c.data.circuit_decision,c.known_at,asOf),fr=completion(f.data.completion,f.known_at,asOf);
  if(cr.status!=='evaluated'||!cr.matches_recorded||fr.status!=='evaluated'||!fr.matches_recorded)return unknown('circuit_completion_unknown_or_mismatch');
  const cd=c.data.circuit_decision,fd=f.data.completion;if(clock(cd.reads_started_at)<a||clock(cd.inputs_resolved_at)>b||clock(fd.observed_at)<clock(cd.inputs_resolved_at)||clock(fd.observed_at)>b)return unknown('circuit_completion_clock');
  if(fd.input.circuitAllowed!==cr.expected_decision.allowed||fd.input.circuitReason!==cr.expected_decision.reason)return unknown('circuit_completion_conflict');expected=fr.expected_decision;
 }
 if(!end.data.decision||['allowed','reason','remainingDailyRiskUsd'].some(k=>end.data.decision[k]!==expected[k]))return unknown('terminal_mismatch');
 if(expected.allowed&&end.data.financial_output_status!=='finite')return unknown('nonfinite_terminal');
 return {status:'decisions_replayed' as const,guard_invocation_id:id,expected_decision:expected,account_state_coverage:'not_established' as const,query_lineage:'not_established' as const,economic_roi:null};
}

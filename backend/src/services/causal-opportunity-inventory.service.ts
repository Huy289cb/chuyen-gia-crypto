import {h1Candidates,h1RetestPlan,type H1Bar,type H1Candidate} from '../utils/h1-causal-plan';
import {h2Candidates,h2ReclaimPlan,type H2Candidate} from '../utils/h2-causal-plan';

type Row = {mechanism:'H1';candidate:H1Candidate}|{mechanism:'H2';candidate:H2Candidate};
export interface CausalInventoryState {
  version:'h1-h2-inventory-v1';
  lastAt:number|null;
  seen:string[];
  pending:Row[];
}
export interface CausalInventoryInput {
  state:CausalInventoryState;
  at:number;
  bars:{hour:H1Bar[];five:H1Bar[];fifteen:H1Bar[];fourHour:H1Bar[]};
}
export function emptyCausalInventory():CausalInventoryState {
  return {version:'h1-h2-inventory-v1',lastAt:null,seen:[],pending:[]};
}

/** Shared producer only. Returned plans require upstream review and actual executor guards.
 * Persist state and events together before delivering plans; this reducer never places orders.
 */
export function advanceCausalInventory(input:CausalInventoryInput) {
  const {state,at,bars}=input;
  if(state.version!=='h1-h2-inventory-v1'||!Number.isFinite(at)||
    (state.lastAt!==null&&at<state.lastAt))throw new Error('invalid_inventory_version_or_clock');
  if(state.lastAt===at)return {state,events:[]};
  const seen=new Set(state.seen),pending=state.pending.slice();
  if(seen.size!==state.seen.length||new Set(pending.map(r=>r.candidate.id)).size!==pending.length||
    pending.some(r=>!seen.has(r.candidate.id)||r.candidate.knownAt>at))throw new Error('invalid_inventory_state');
  const events:Array<{kind:'observed'|'resolved';at:number;row:Row;outcome?:ReturnType<typeof h1RetestPlan>|ReturnType<typeof h2ReclaimPlan>}>=[];
  // Fixed registered detector cadences; callers must supply every closed 5m tick (+5s grace).
  const discovered:Row[]=[];
  if((at-5000)%3600000===0)discovered.push(...h1Candidates(bars.hour,at).map(candidate=>({mechanism:'H1' as const,candidate})));
  if((at-5000)%300000===0)discovered.push(...h2Candidates(bars.hour,bars.five,at).map(candidate=>({mechanism:'H2' as const,candidate})));
  for(const row of discovered){
    if(seen.has(row.candidate.id))continue;
    seen.add(row.candidate.id);pending.push(row);events.push({kind:'observed',at,row});
  }
  const waiting:Row[]=[];
  for(const row of pending){
    // H1 was registered on closed 15m ticks; evaluating at 5m would change expiry accounting.
    if(row.mechanism==='H1'&&(at-5000)%900000!==0){waiting.push(row);continue;}
    const outcome=row.mechanism==='H1'?h1RetestPlan(row.candidate,bars.fifteen,bars.fourHour,at):h2ReclaimPlan(row.candidate,bars.five,at);
    if(outcome.status==='waiting')waiting.push(row);
    else events.push({kind:'resolved',at,row,outcome});
  }
  return {state:{version:state.version,lastAt:at,seen:[...seen],pending:waiting},events};
}

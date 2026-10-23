import {evaluateStructureSidePermission} from '../config/v3-structure-bias-policy';
import {timeframeDurationMs} from './closed-candles';
const obj=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const equal=(a:unknown,b:unknown):boolean=>{if(a===b)return true;if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((v,i)=>equal(v,b[i]));const x=obj(a),y=obj(b);return !!x&&!!y&&Object.keys(x).length===Object.keys(y).length&&Object.keys(x).every(k=>Object.hasOwn(y,k)&&equal(x[k],y[k]));};
export function replayRecordedStructurePermission(record:unknown,knownAt:number,asOf:number){
 const unknown=(reason:string)=>({status:'unknown' as const,reason});
 if(!Number.isFinite(knownAt)||!Number.isFinite(asOf)||knownAt>asOf)return unknown('invalid_knowledge_cutoff');
 const d=obj(record),input=obj(d?.input),decision=obj(d?.decision),observed=typeof d?.observed_at==='string'?Date.parse(d.observed_at):NaN;
 if(d?.schema!=='structure-permission-v1'||!input||!decision||!Number.isFinite(observed)||observed>knownAt)return unknown('missing_recorded_permission');
 const duration=typeof d.timeframe==='string'?timeframeDurationMs(d.timeframe):null;
 if(!duration||!['long','short'].includes(String(input.side))||!['enabled','shortRequireBos','longRequireBos'].every(k=>typeof input[k]==='boolean')||!Number.isSafeInteger(input.strength)||Number(input.strength)<1||!Array.isArray(input.candles))return unknown('missing_resolved_structure_policy');
 let prior=-Infinity;const candles:{timestamp:number;high:number;low:number;close:number}[]=[];
 for(const value of input.candles){const c=obj(value);if(!c||![c.timestamp,c.high,c.low,c.close].every(Number.isFinite)||Number(c.timestamp)<=prior||Number(c.timestamp)+duration>observed||Number(c.high)<Number(c.low)||Number(c.low)<=0||Number(c.close)<Number(c.low)||Number(c.close)>Number(c.high))return unknown('invalid_or_unclosed_structure_candles');prior=Number(c.timestamp);candles.push(c as unknown as typeof candles[number]);}
 const expected=evaluateStructureSidePermission({side:input.side as 'long'|'short',candles,enabled:input.enabled as boolean,strength:input.strength as number,shortRequireBos:input.shortRequireBos as boolean,longRequireBos:input.longRequireBos as boolean});
 return {status:'evaluated' as const,matches_recorded:equal(expected,decision),expected_decision:expected,execution_feasibility:'not_established' as const};
}

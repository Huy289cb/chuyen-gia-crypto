import {it,expect} from 'vitest';import {observedAccountFieldConvergence as converge} from '../../src/utils/account-field-convergence';
const w=(event_id:number,start:number,end:number,update:Record<string,unknown>)=>({event_id,start,end,update});
it('retains agreed scalars across overlapping writes without inventing their order',()=>{
 expect(converge([w(1,0,10,{balance:30,updated:'a'}),w(2,5,15,{balance:30,updated:'b'})])).toEqual([
 {field:'balance',status:'converged',reason:null,value:30,candidate_event_ids:[1,2]},
 {field:'updated',status:'unknown',reason:'unordered_values_or_increment',value:null,candidate_event_ids:[1,2]}]);
});
it('keeps conflicting concurrent values unknown until a strictly later overwrite',()=>{
 const writes=[w(1,0,10,{balance:30}),w(2,5,15,{balance:29})];expect(converge(writes)[0].status).toBe('unknown');
 expect(converge([...writes,w(3,16,20,{balance:28})])[0]).toMatchObject({status:'converged',value:28,candidate_event_ids:[3]});
});
it('does not turn same-millisecond boundaries or increments into causal scalar proof',()=>{
 expect(converge([w(1,0,10,{balance:30}),w(2,10,12,{balance:29})])[0].status).toBe('unknown');
 expect(converge([w(1,0,1,{trades:{increment:1}})])[0].status).toBe('unknown');
});
it('handles disjoint fields and rejects invalid clocks',()=>{
 expect(converge([w(1,0,10,{balance:30}),w(2,5,15,{trades:2})]).every(f=>f.status==='converged')).toBe(true);
 expect(converge([w(1,10,0,{balance:30})])[0].reason).toBe('invalid_write_interval');
});

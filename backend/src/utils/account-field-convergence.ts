/** Final values implied by supplied write intervals, never full account/commit-order proof. */
export function observedAccountFieldConvergence(writes:readonly {event_id:number|string;start:number;end:number;update:Record<string,unknown>}[]) {
 const fields=[...new Set(writes.flatMap(w=>Object.keys(w.update)))];
 return fields.map(field=>{
  const relevant=writes.filter(w=>Object.hasOwn(w.update,field));
  if(relevant.some(w=>!Number.isFinite(w.start)||!Number.isFinite(w.end)||w.end<w.start))return {field,status:'unknown' as const,reason:'invalid_write_interval',value:null,candidate_event_ids:[]};
  const candidates=relevant.filter(w=>!relevant.some(other=>other.start>w.end));
  const value=candidates[0]?.update[field];
  const scalar=value===null||['number','string','boolean'].includes(typeof value);
  const agreed=scalar&&!(typeof value==='number'&&!Number.isFinite(value))&&candidates.every(w=>Object.is(w.update[field],value));
  return {field,status:agreed?'converged' as const:'unknown' as const,reason:agreed?null:'unordered_values_or_increment',value:agreed?value:null,candidate_event_ids:candidates.map(w=>w.event_id)};
 });
}

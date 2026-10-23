/** Offline, explicit admission arithmetic only; never calls an exchange or database. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {auditRecordedAdmission} from '../src/utils/recorded-admission-audit';
const [source,out]=process.argv.slice(2);if(!source||!out)throw Error('Usage: tsx scripts/audit-recorded-admission.ts EXPORT NEW_OUTPUT');
const bytes=readFileSync(source),data=JSON.parse(bytes.toString());
const rows=(data.events??[]).filter((e:any)=>e.event_type==='entry_trace'&&['quantity_checked','risk_checked'].includes(e.event_data?.stage))
 .map((e:any)=>({id:e.id,timestamp:e.timestamp,traceId:e.event_data.trace_id??null,codeHash:e.event_data.code_hash??null,policyHash:e.event_data.policy_hash??null,
 stage:e.event_data.stage,...auditRecordedAdmission(e.event_data)}));
const counts=Object.fromEntries(['matched','mismatch','unknown'].map(status=>[status,rows.filter((r:any)=>r.status===status).length]));
const report={schema:'recorded-admission-arithmetic-v1',sourceSha256:createHash('sha256').update(bytes).digest('hex'),
 sourceHashes:Object.fromEntries([__filename,'src/utils/recorded-admission-audit.ts','src/utils/execution-risk.ts','src/utils/order-quantity.ts'].map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')])),counts,rows,
 scope:'Arithmetic of recorded quantity/risk inputs against current shared pure helpers. Matched does not establish historical source parity, full admission, fill, ROI or opportunity improvement. Missing historical inputs remain unknown.'};
writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(counts));

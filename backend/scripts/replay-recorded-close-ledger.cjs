const fs=require('node:fs'),crypto=require('node:crypto');require('tsx/cjs');
const {replayCloseLedgerJournal}=require('../src/utils/recorded-close-ledger.ts');
const [input,cutoff,out]=process.argv.slice(2);if(!out||fs.existsSync(out))throw Error('Usage: EXPORT ISO_CUTOFF NEW_REPORT');
const bytes=fs.readFileSync(input),source=JSON.parse(bytes);if(!Array.isArray(source.events))throw Error('missing_events');
const report={...replayCloseLedgerJournal(source.events,Date.parse(cutoff)),input_sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({associated:report.rows.filter(r=>r.status==='associated').length,unknown:report.unknown.length+report.rows.filter(r=>r.status==='unknown').length,excludedFuture:report.excludedFuture}));

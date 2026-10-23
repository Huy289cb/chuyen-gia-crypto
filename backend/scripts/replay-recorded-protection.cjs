const fs=require('node:fs'),crypto=require('node:crypto');require('tsx/cjs');
const {replayProtectionJournal}=require('../src/utils/recorded-protection-journal.ts');
const [input,cutoff,out]=process.argv.slice(2);if(!out||fs.existsSync(out))throw Error('Usage: EXPORT ISO_CUTOFF NEW_REPORT');
const bytes=fs.readFileSync(input),source=JSON.parse(bytes);if(!Array.isArray(source.events))throw Error('missing_events');
const report={...replayProtectionJournal(source.events,Date.parse(cutoff)),input_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),input_events:source.events.length};
fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({evaluated:report.evaluated,unknown:report.unknown,mismatches:report.mismatches,excludedFuture:report.excludedFuture}));

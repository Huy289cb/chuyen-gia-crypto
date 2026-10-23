const fs=require('node:fs'),crypto=require('node:crypto');require('tsx/cjs');
const {replayCancelJournal}=require('../src/utils/recorded-cancel-journal.ts');
const [input,cutoff,out]=process.argv.slice(2);if(!out)throw Error('Usage: EXPORT ISO_CUTOFF NEW_REPORT');
const bytes=fs.readFileSync(input),source=JSON.parse(bytes);if(!Array.isArray(source.events))throw Error('missing_events');
const report=replayCancelJournal(source.events,Date.parse(cutoff));report.input_sha256=crypto.createHash('sha256').update(bytes).digest('hex');
fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({attempts:report.rows.length,unknown:report.unknown.length,excludedFuture:report.excludedFuture}));

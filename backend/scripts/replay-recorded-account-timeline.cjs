const fs=require('node:fs'),crypto=require('node:crypto');require('tsx/cjs');
const [input,cutoff,out,seedFile]=process.argv.slice(2);if(!out||fs.existsSync(out))throw Error('Usage: EXPORT ISO_CUTOFF NEW_REPORT [SNAPSHOT]');
const bytes=fs.readFileSync(input),source=JSON.parse(bytes);if(!Array.isArray(source.events))throw Error('missing_events');
const seedBytes=seedFile?fs.readFileSync(seedFile):null;
const report={...require('../src/utils/recorded-account-timeline.ts').replayAccountOverwriteTimeline(source.events,Date.parse(cutoff),seedBytes?JSON.parse(seedBytes):undefined),input_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),seed_sha256:seedBytes?crypto.createHash('sha256').update(seedBytes).digest('hex'):null};
fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({accounts:report.accounts.length,unknown:report.unknown.length}));

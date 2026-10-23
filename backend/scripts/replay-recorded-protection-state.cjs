const fs=require('node:fs'),crypto=require('node:crypto');require('tsx/cjs');
const {replayRecordedProtectionState:replay}=require('../src/utils/recorded-protection-state.ts');
const [input,cutoff,out]=process.argv.slice(2);if(!out||fs.existsSync(out))throw Error('Usage: EXPORT ISO_CUTOFF NEW_REPORT');
const bytes=fs.readFileSync(input),result=replay(JSON.parse(bytes),Date.parse(cutoff));
fs.writeFileSync(out,JSON.stringify({schema:'recorded-protection-state-replay-v1',input_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),as_of:cutoff,result},null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({status:result.status,flat_at_position_query:result.flat_at_position_query??null}));

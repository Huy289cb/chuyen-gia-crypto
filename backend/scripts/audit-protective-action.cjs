const fs=require('node:fs'),crypto=require('node:crypto'),Module=require('node:module'),assert=require('node:assert/strict');require('tsx/cjs');
const current=require('../src/utils/protective-action.ts');const [baseline,out]=process.argv.slice(2);if(!out)throw Error('Usage: BASELINE_SERVICE NEW_REPORT');const bytes=fs.readFileSync(baseline),m=new Module(baseline,module);m.filename=baseline;m.require=()=>({});m._compile(bytes.toString(),baseline);let cases=0;
for(const side of ['long','short'])for(const stop_loss of [90,100,110])for(const take_profit of [90,100,110])for(const mark of [0,NaN,95,100,105])for(const levels of [undefined,{stop_loss:90,take_profit:110},{stop_loss:110,take_profit:90}]){
 const input={side,stop_loss,take_profit,mark,levels};assert.equal(current.evaluateProtectiveAction(input),m.exports.evaluateProtectiveAction(input));cases++;
}
fs.writeFileSync(out,JSON.stringify({cases,decisionParity:true,baselineSha256:crypto.createHash('sha256').update(bytes).digest('hex'),limits:'Pure mark/levels action only. No exchange ACK, close fill, ledger or full portfolio parity.'},null,2),{flag:'wx'});console.log(JSON.stringify({cases,decisionParity:true}));

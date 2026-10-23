const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');require('tsx/cjs');const {validPartialFillEvidence}=require('../src/utils/partial-fill-evidence.ts');
const [baseline,out]=process.argv.slice(2);if(!out)throw Error('Usage: BASELINE_SERVICE NEW_REPORT');const bytes=fs.readFileSync(baseline),source=bytes.toString();
function condition(message){const end=source.indexOf("throw new Error('"+message+"')");if(end<0)throw Error('missing_condition');const start=source.lastIndexOf('if (',end);const prefix=source.slice(start,end).trim();if(!prefix.endsWith('{'))throw Error('invalid_condition');return new Function('remote','orderId','symbol','observedQty',prefix+'return false;} return true;');}
const initial=condition('Invalid partial-fill order evidence'),final=condition('Invalid final partial-fill order evidence');let cases=0;
for(const remoteOrderId of [123,124,NaN])for(const remoteSymbol of ['BTCUSDT','ETHUSDT'])for(const qty of [0,.001,.002,NaN])for(const minimum of [.001,.002]){
 const remote={orderId:remoteOrderId,symbol:remoteSymbol,executedQty:qty};
 const base={orderId:123,symbol:'BTCUSDT',remoteOrderId,remoteSymbol,executedQty:qty};
 assert.equal(validPartialFillEvidence({...base,minimumObservedQty:0,requirePositive:true}),initial(remote,123,'BTCUSDT',qty));
 assert.equal(validPartialFillEvidence({...base,minimumObservedQty:minimum,requirePositive:false}),final(remote,123,'BTCUSDT',minimum));cases+=2;
}
fs.writeFileSync(out,JSON.stringify({cases,conditionParity:true,baselineSha256:crypto.createHash('sha256').update(bytes).digest('hex'),limits:'Initial/final partial-fill validation only. Not full fill/protection lifecycle or profitability'},null,2),{flag:'wx'});console.log(JSON.stringify({cases,conditionParity:true}));

const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');require('tsx/cjs');
const {confirmsZeroFillCancellation}=require('../src/utils/pending-cancel-transition.ts');const [baseline,out]=process.argv.slice(2);if(!out)throw Error('Usage: FROZEN_SERVICE_JS NEW_REPORT');
const bytes=fs.readFileSync(baseline),source=bytes.toString();const start=source.indexOf('if (!ack || String(ack.orderId)');const end=source.indexOf("throw new Error('pending_cancel_requires_reconciliation')",start);if(start<0||end<0)throw Error('missing_compiled_condition');
const condition=source.slice(start,end).trim();if(!condition.endsWith('{'))throw Error('unexpected_condition');
const legacy=new Function('ack','order',condition+'return false;} return true;');let cases=0;
for(const orderId of [123,124])for(const symbol of ['BTCUSDT','ETHUSDT'])for(const status of ['CANCELED','FILLED','NEW'])for(const executedQty of [0,'0',.001,null,undefined,'unknown']){
 const ack={orderId,symbol,status,executedQty},order={symbol:'BTC',binance_order_id:'123'};assert.equal(confirmsZeroFillCancellation({symbol:order.symbol,exchangeOrderId:order.binance_order_id,ack}),legacy(ack,order));cases++;
}
fs.writeFileSync(out,JSON.stringify({cases,conditionParity:true,baselineSha256:crypto.createHash('sha256').update(bytes).digest('hex'),scope:'Cancel ACK condition only, not whole fill/protection lifecycle or ROI'},null,2),{flag:'wx'});console.log(JSON.stringify({cases,conditionParity:true}));

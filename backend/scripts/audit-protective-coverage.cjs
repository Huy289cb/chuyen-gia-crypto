const fs=require('node:fs'),crypto=require('node:crypto'),Module=require('node:module'),assert=require('node:assert/strict');require('tsx/cjs');
const shared=require('../src/utils/protective-coverage.ts');const [baseline,out]=process.argv.slice(2);if(!out||fs.existsSync(out))throw Error('Usage: BASELINE_SERVICE NEW_REPORT');
const bytes=fs.readFileSync(baseline),m=new Module(baseline,module);m.filename=baseline;m.require=()=>({});m._compile(bytes.toString(),baseline);
let cases=0;
for(const side of ['long','short'])for(const symbol of ['BTCUSDT','ETHUSDT'])for(const orderSide of ['BUY','SELL'])for(const positionSide of [undefined,'BOTH','LONG','SHORT'])for(const orderType of ['STOP_MARKET','TAKE_PROFIT_MARKET','LIMIT']){
 const position={symbol:'BTC',symbolUsdt:'BTCUSDT',side,positionAmt:.001,entryPrice:100,markPrice:100,rawPositionSide:'BOTH'};
 const orders=[{symbol,side:orderSide,positionSide,orderType,algoId:'1',quantity:.0001},{symbol,side:orderSide,positionSide,orderType,orderId:'2'}];
 assert.deepEqual(shared.classifyProtectiveCoverage(position,orders),m.exports.classifyProtectiveCoverage(position,orders));cases++;
}
const report={cases,baselineSha256:crypto.createHash('sha256').update(bytes).digest('hex'),classificationParity:true,limits:'Legacy matching IDs/counts only. Does not validate order quantity, trigger/status/close flags, query completeness or current exchange protection.'};
fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));

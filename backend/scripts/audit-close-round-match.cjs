const fs=require('node:fs'),crypto=require('node:crypto'),Module=require('node:module'),assert=require('node:assert/strict');require('tsx/cjs');
const {selectCloseExchangeRound:select}=require('../src/utils/close-round-match.ts'),{reconstructExchangeRounds}=require('../src/utils/exchange-rounds.ts');
const [baseline,out]=process.argv.slice(2);if(!out||fs.existsSync(out))throw Error('Usage: BASELINE_SERVICE NEW_REPORT');
const bytes=fs.readFileSync(baseline),m=new Module(baseline,module);m.filename=baseline;m.require=()=>({});m._compile(bytes.toString(),baseline);
const rounds=reconstructExchangeRounds([{tradeId:1,orderId:'entry',side:'BUY',price:100,qty:1,commission:.1,commissionAsset:'USDT',realizedPnl:0,time:1000},
 {tradeId:2,orderId:'exit',side:'SELL',price:110,qty:1,commission:.1,commissionAsset:'USDT',realizedPnl:10,time:2000}]);
(async()=>{const original=process.env.BINANCE_ENABLED;process.env.BINANCE_ENABLED='true';let cases=0;
 try{for(const inventory of [rounds,[],[...rounds,...rounds]])for(const side of ['long','buy','short','sell'])for(const qty of [0,1,-1,2,NaN])for(const entry of ['entry','exit','missing']){
  const result=await m.exports.resolveClosePnlFromUserTrades({symbol:'BTC',side,entryTime:new Date(1000),closeTime:new Date(2000),entryOrderId:entry,sizeQty:qty,entryPrice:100,fallbackClosePrice:110,rounds:inventory});
  const actual=select(inventory,side,entry,qty);assert.equal(Boolean(actual),result.verified);if(actual)assert.deepEqual(actual,result.round);cases++;
 }}finally{if(original===undefined)delete process.env.BINANCE_ENABLED;else process.env.BINANCE_ENABLED=original;}
 const report={cases,selectionParity:true,baselineSha256:crypto.createHash('sha256').update(bytes).digest('hex'),liveQueries:0,limits:'Round selection on supplied fixtures only. Preserves legacy coercion/nonfinite behavior; strict recorded adapter rejects missing/nonfinite inputs. No real fill/cost/portfolio proof.'};
 fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});

const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict'),ts=require('typescript');require('tsx/cjs');
const shared=require('../src/utils/close-account-update.ts'),[baseline,out]=process.argv.slice(2);if(!out||fs.existsSync(out))throw Error('Usage: BASELINE_SERVICE NEW_REPORT');
const bytes=fs.readFileSync(baseline),source=bytes.toString(),ast=ts.createSourceFile('baseline.js',source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS),matches=[];
function visit(n){if(ts.isIfStatement(n)&&n.expression.getText(ast).includes('!isBookkeepingClose')&&n.expression.getText(ast).includes('fillVerified'))matches.push(n);ts.forEachChild(n,visit);}visit(ast);
assert.equal(matches.length,1);const block=matches[0].getText(ast);
const evaluate=new Function('isBookkeepingClose','fillVerified','enabled','pnl','balance','now',`return (async()=>{let captured=null;const realizedPnl=pnl,position={account:{current_balance:balance},account_id:1},process={env:{BINANCE_ENABLED:enabled?'true':'false'}},Date=class extends globalThis.Date{constructor(){super(now)}};const prisma_1={prisma:{testnetAccount:{update:async args=>{captured=args.data}}}};${block};return captured;})()`);
(async()=>{
 let cases=0;const now=Date.parse('2026-10-02T12:45:00Z');
 for(const bookkeeping of [false,true])for(const verified of [false,true])for(const enabled of [false,true])for(const pnl of [-1,-.010001,-.01,0,.01,.010001,1])for(const balance of [0,30]){
  const expected=await evaluate(bookkeeping,verified,enabled,pnl,balance,now);
  const actual=shared.shouldUpdateClosedAccount(bookkeeping,verified,enabled)?shared.buildCloseAccountUpdate({balance,realizedPnl:pnl,lastTradeTime:new Date(now),updatedAt:new Date(now)}):null;
  const comparable=value=>value===null?null:{...value,last_trade_time:value.last_trade_time.getTime(),updated_at:value.updated_at.getTime()};
  assert.deepEqual(comparable(actual),comparable(expected));cases++;
 }
 const report={cases,baselineSha256:crypto.createHash('sha256').update(bytes).digest('hex'),accountWriteIntentParity:true,limits:'Account bookkeeping intent only. Does not prove fill identity, cost/funding completeness, persisted transaction success, wallet sync or full portfolio parity.'};
 fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});

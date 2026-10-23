const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),ts=require('typescript');
const pkg=path.resolve(process.argv[2]),manifest=JSON.parse(fs.readFileSync(path.join(pkg,'manifest.json'))),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.deepEqual(manifest.changedFiles,['services/position-close.service.js','utils/close-account-update.js','utils/recorded-close-account.js']);
for(const variant of ['baseline','release'])for(const[f,h]of Object.entries(manifest[variant]))assert.equal(sha(fs.readFileSync(path.join(pkg,variant,f))),h);
const file='services/position-close.service.js',parse=variant=>ts.createSourceFile(file,fs.readFileSync(path.join(pkg,variant,file),'utf8'),ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);
const base=parse('baseline'),release=parse('release'),branches=[];
function find(n){if(ts.isIfStatement(n)&&n.expression.getText(base).includes('!isBookkeepingClose')&&n.expression.getText(base).includes('fillVerified'))branches.push(n);ts.forEachChild(n,find);}find(base);assert.equal(branches.length,1);
let requires=0,replacements=0;
const transformed=ts.transform(release,[ctx=>root=>{function visit(n){
 if(ts.isVariableStatement(n)&&n.declarationList.declarations.length===1&&n.declarationList.declarations[0].name.getText(release)==='close_account_update_1'){requires++;return undefined;}
 if(ts.isIfStatement(n)&&n.expression.getText(release).includes('close_account_update_1.shouldUpdateClosedAccount')){replacements++;return ts.factory.createEmptyStatement();}
 return ts.visitEachChild(n,visit,ctx);
}return ts.visitNode(root,visit);}]);
const baselineStripped=ts.transform(base,[ctx=>root=>{function visit(n){if(n===branches[0])return ts.factory.createEmptyStatement();return ts.visitEachChild(n,visit,ctx);}return ts.visitNode(root,visit);}]);
const printer=ts.createPrinter({removeComments:true});if(printer.printFile(transformed.transformed[0])!==printer.printFile(baselineStripped.transformed[0]))throw Error('outside-account-branch module AST differs');transformed.dispose();baselineStripped.dispose();assert.equal(requires,1);assert.equal(replacements,1);
const shared=require(path.join(pkg,'release/utils/close-account-update.js')),replay=require(path.join(pkg,'release/utils/recorded-close-account.js')).replayRecordedCloseAccount;
const evaluate=new Function('isBookkeepingClose','fillVerified','enabled','pnl','balance','now',`return(async()=>{let captured=null;const realizedPnl=pnl,position={account:{current_balance:balance},account_id:1},process={env:{BINANCE_ENABLED:enabled?'true':'false'}},Date=class extends globalThis.Date{constructor(){super(now)}};const prisma_1={prisma:{testnetAccount:{update:async args=>captured=args.data}}};${branches[0].getText(base)};return captured;})()`);
(async()=>{let cases=0,replayed=0;const now=Date.parse('2026-10-02T12:45:00Z');
 for(const bookkeeping of [false,true])for(const verified of [false,true])for(const enabled of [false,true])for(const pnl of [-1,-.010001,-.01,0,.01,.010001,1])for(const balance of [0,30]){
  const expected=await evaluate(bookkeeping,verified,enabled,pnl,balance,now),actual=shared.shouldUpdateClosedAccount(bookkeeping,verified,enabled)?shared.buildCloseAccountUpdate({balance,realizedPnl:pnl,lastTradeTime:new Date(now),updatedAt:new Date(now)}):null;
  const comparable=value=>value===null?null:{...value,last_trade_time:value.last_trade_time.getTime(),updated_at:value.updated_at.getTime()};assert.deepEqual(comparable(actual),comparable(expected));cases++;
  if(actual){const record=JSON.parse(JSON.stringify({schema:'close-account-update-v1',account_id:1,input:{balance,realized_pnl:pnl,bookkeeping,fill_verified:verified,binance_enabled:enabled,last_trade_time:new Date(now).toISOString(),updated_at:new Date(now).toISOString()},update:actual,applied_at:new Date(now).toISOString()}));const result=replay(record,now,now);assert.equal(result.status,'evaluated');assert.equal(result.matches_recorded,true);replayed++;}
 }
 assert.ok(replayed>0);const report={allPackageHashesVerified:true,wholeModuleOutsideReplacedAccountBranchMatches:true,compiledAccountCases:cases,compiledJsonReplayCases:replayed,limits:'Compiled branch/helper/adapter parity only; no real account write, wallet sync, full close-service integration or portfolio ledger proof.'};
 fs.writeFileSync(path.join(pkg,'compiled-tests.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});

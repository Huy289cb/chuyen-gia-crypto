const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('typescript');
const [pack,report]=process.argv.slice(2);if(!pack||!report)throw Error('PACKAGE NEW_REPORT required');
const rel='services/account-risk-guard.service.js';
const before=fs.readFileSync(path.join(pack,'baseline',rel),'utf8');
let after=fs.readFileSync(path.join(pack,'release',rel),'utf8');
function segment(text,start,end){assert.equal(text.split(start).length,2,'unique start '+start);const a=text.indexOf(start),b=text.indexOf(end,a);assert.ok(b>a,'end '+end);return {a,b,text:text.slice(a,b)};}
function restore(oldStart,newStart,end){const old=segment(before,oldStart,end),next=segment(after,newStart,end);after=after.slice(0,next.a)+old.text+after.slice(next.b);}
restore(' if (protectiveBlock) {','    const initialGuard =',"    if (process.env.BINANCE_ENABLED === 'true' && symbol)");
restore('                await prisma_1.prisma.testnetAccount.update({','                const evidence =','            }\n            return streak;');
const publisher=segment(after,"const node_crypto_1 = require('node:crypto');",'async function resolveLossStreak');
const parsed=ts.createSourceFile('publisher.js',publisher.text,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);
assert.equal(parsed.statements.length,3);assert.ok(ts.isFunctionDeclaration(parsed.statements[2]));assert.equal(parsed.statements[2].name.text,'publishGuardMutation');
after=after.slice(0,publisher.a)+after.slice(publisher.b);
const print=text=>ts.createPrinter({removeComments:true}).printFile(ts.createSourceFile('guard.js',text,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS));
assert.equal(print(after),print(before),'whole AST outside explicit change regions');
fs.writeFileSync(report,JSON.stringify({passed:true,wholeAstOutsideRegionsMatches:true,excludedRegions:['initial protective/cooldown branch','exchange loss-streak successful write branch','new two imports and publisher'],runtimeDeployed:false},null,2),{flag:'wx',mode:0o600});console.log('Guard outside-region AST matches');

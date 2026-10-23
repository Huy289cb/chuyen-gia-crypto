import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createSourceFile,ScriptTarget,ScriptKind,isFunctionDeclaration} from 'typescript';
import {buildRepositoryBalanceUpdate,buildRepositoryStatsUpdate} from '../../src/utils/repository-account-update';
const source=readFileSync('dist/repositories/testnet.repository.js','utf8');
const ast=createSourceFile('repository.js',source,ScriptTarget.ES2022,true,ScriptKind.JS);
const now=new Date('2026-10-03T00:00:00Z');
class Clock extends Date {constructor(){super(now);} }
async function deployed(name:string,args:unknown[]){let write:any;const n=ast.statements.find(n=>isFunctionDeclaration(n)&&n.name?.text===name)!;
 const run=new Function('prisma_1','Date',n.getText(ast)+`; return ${name};`)(
  {prisma:{testnetAccount:{update:async(v:any)=>{write=v;}}}},Clock);
 await run(1,...args);return JSON.parse(JSON.stringify(write.data));
}
it('matches actual deployed balance write over signed amounts and default pnl',async()=>{
 for(const balance of [0,30,-1])for(const pnl of [-1,0,1,.005])expect(JSON.parse(JSON.stringify(buildRepositoryBalanceUpdate(balance,pnl,now)))).toEqual(await deployed('updateTestnetAccountBalance',[balance,pnl]));
 expect(JSON.parse(JSON.stringify(buildRepositoryBalanceUpdate(30,0,now)))).toEqual(await deployed('updateTestnetAccountBalance',[30]));
});
it('matches deployed stats increment versus reset and both timestamp fields',async()=>{
 for(const win of [true,false])expect(JSON.parse(JSON.stringify(buildRepositoryStatsUpdate(win,now)))).toEqual(await deployed('updateTestnetAccountStats',[win]));
});

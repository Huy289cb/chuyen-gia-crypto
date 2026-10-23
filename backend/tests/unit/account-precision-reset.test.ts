import {replayRecordedPrecisionReset as replay} from '../../src/utils/recorded-precision-reset';
import {it,expect,vi,beforeEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {createSourceFile,ScriptTarget,ScriptKind,isFunctionDeclaration} from 'typescript';
import {buildPrecisionResetUpdate} from '../../src/utils/precision-reset-update';
const update=vi.hoisted(()=>vi.fn());const journal=vi.hoisted(()=>vi.fn().mockResolvedValue(undefined));
vi.mock('../../src/lib/prisma',()=>({prisma:{testnetAccount:{update}}}));
vi.mock('../../src/utils/account-wallet-journal',()=>({persistAccountWalletObservation:journal}));
import {resetPrecisionErrorTracking} from '../../src/repositories/testnet.repository';
 const source=readFileSync('dist/repositories/testnet.repository.js','utf8');const ast=createSourceFile('repo.js',source,ScriptTarget.ES2022,true,ScriptKind.JS);
 const fn=ast.statements.find(n=>isFunctionDeclaration(n)&&n.name?.text==='resetPrecisionErrorTracking')!;
beforeEach(()=>{vi.clearAllMocks();update.mockResolvedValue({id:1});});
it('matches deployed reset write without resetting unrelated account fields',async()=>{
 const now=new Date('2026-10-03T00:00:00Z');class Clock extends Date{constructor(){super(now);}}
 let recorded:any;const run=new Function('prisma_1','Date',fn.getText(ast)+';return resetPrecisionErrorTracking;')({prisma:{testnetAccount:{update:async(v:any)=>{recorded=v;return {id:1};}}}},Clock);
 expect(await run(1)).toEqual({id:1});expect(JSON.parse(JSON.stringify(buildPrecisionResetUpdate(now)))).toEqual(JSON.parse(JSON.stringify(recorded.data)));
});
it('returns the exact DB result and journals successful reset',async()=>{
 const account={id:1,current_balance:30};update.mockResolvedValueOnce(account);
 expect(await resetPrecisionErrorTracking(1)).toBe(account);
 await vi.waitFor(()=>expect(journal).toHaveBeenCalledTimes(1));
 expect(journal.mock.calls[0]).toEqual([expect.objectContaining({schema:'account-precision-reset-v1',account_id:1,applied_clock_source:'db_update_return'}),'account_precision_reset_applied']);
 expect(update.mock.calls[0][0].data).not.toHaveProperty('cooldown_until');
 expect(replay(journal.mock.calls[0][0],Date.now(),Date.now()+100)).toMatchObject({status:'evaluated',matches_recorded:true});
});
it('does not journal a failed DB reset',async()=>{
 update.mockRejectedValueOnce(new Error('DB failed'));await expect(resetPrecisionErrorTracking(1)).rejects.toThrow('DB failed');expect(journal).not.toHaveBeenCalled();
});
it('does not await pending journal persistence',async()=>{
 journal.mockImplementationOnce(()=>new Promise(()=>{}));expect(await resetPrecisionErrorTracking(1)).toEqual({id:1});
});
it('keeps successful DB result when journal persistence rejects',async()=>{
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 try{
  journal.mockRejectedValueOnce(new Error('journal unavailable'));
  expect(await resetPrecisionErrorTracking(1)).toEqual({id:1});
  await vi.waitFor(()=>expect(warn).toHaveBeenCalledWith('[TestnetRepository] Precision reset journal unavailable'));
 }finally{warn.mockRestore();}
});

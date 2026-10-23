require('tsx/cjs');const {commitAtomicVerifiedClose}=require('../src/utils/atomic-verified-close.ts');
const fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('assert/strict'),{PrismaClient}=require('@prisma/client');
const out=process.argv[2];if(!out||fs.existsSync(out))throw Error('NEW_REPORT required');
const url=process.env.ROI_ATOMIC_TEST_DATABASE_URL;if(!url)throw Error('missing_isolated_test_url');const parsed=new URL(url);if(parsed.hostname!=='127.0.0.1'||parsed.port!=='55439'||parsed.pathname!=='/crypto_reset_test')throw Error('refusing_nonisolated_database');
const root=path.resolve(__dirname,'..');cp.execFileSync(process.execPath,[require.resolve('prisma/build/index.js'),'db','push','--schema',path.join(root,'prisma/schema.prisma'),'--skip-generate'],{cwd:root,env:{...process.env,DATABASE_URL:url},stdio:'pipe',timeout:60000});
const db=new PrismaClient({datasources:{db:{url}}}),defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(method,id){const account=await db.testnetAccount.create({data:{symbol:'BTC',method_id:method,starting_balance:30,current_balance:30,equity:30}});await db.testnetPosition.create({data:{position_id:id,account_id:account.id,symbol:'BTC',side:'long',entry_price:100,stop_loss:90,take_profit:110,size_qty:1,size_usd:100,risk_usd:10,risk_percent:1,expected_rr:1}});return {positionId:id,accountId:account.id,closePrice:110,closeReason:'fixture',realizedPnl:1,entryFee:.1,exitFee:.1,fundingFee:0,walletAuthoritative:true};}
(async()=>{
 const input=await fixture('atomic_concurrent_fixture','atomic-concurrent'),held=defer(),release=defer();
 const firstDb={$transaction:work=>db.$transaction(async tx=>work({testnetAccount:tx.testnetAccount,testnetPosition:{updateMany:async arg=>{const result=await tx.testnetPosition.updateMany(arg);held.resolve();await release.promise;return result;}}}),{timeout:15000})};
 const first=commitAtomicVerifiedClose(firstDb,input);await held.promise;const second=commitAtomicVerifiedClose(db,input);
 let observedLock=false;
 try{for(let i=0;i<30;i++){const rows=await db.$queryRawUnsafe("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'");if(rows[0].n>0){observedLock=true;break;}await new Promise(r=>setTimeout(r,20));}}finally{release.resolve();}
 const results=await Promise.all([first,second]);assert(observedLock,'actual contender did not reach PostgreSQL lock');assert.deepEqual(results.map(r=>r.status),['committed','not_claimed']);assert(!('receipt' in results[1]));
 const account=await db.testnetAccount.findUnique({where:{id:input.accountId}});assert.equal(account.total_trades,1);assert.equal(account.realized_pnl,1);assert.equal(account.current_balance,30);
 const retryInput=await fixture('atomic_retry_fixture','atomic-retry');
 await db.$executeRawUnsafe("ALTER TABLE testnet_accounts ADD CONSTRAINT roi_atomic_account_failure CHECK (method_id <> 'atomic_retry_fixture' OR total_trades < 1)");
 await assert.rejects(commitAtomicVerifiedClose(db,retryInput));
 const failed=await db.testnetPosition.findUnique({where:{position_id:retryInput.positionId}});assert.equal(failed.status,'open');assert.equal(failed.close_time,null);assert.equal(failed.realized_pnl,0);
 await db.$executeRawUnsafe('ALTER TABLE testnet_accounts DROP CONSTRAINT roi_atomic_account_failure');
 assert.equal((await commitAtomicVerifiedClose(db,retryInput)).status,'committed');assert.equal((await commitAtomicVerifiedClose(db,retryInput)).status,'not_claimed');
 const retried=await db.testnetAccount.findUnique({where:{id:retryInput.accountId}});assert.equal(retried.total_trades,1);assert.equal(retried.realized_pnl,1);
 const report={isolatedPostgreSQL:true,productionTouched:false,actualRowLockObserved:true,concurrentResults:results.map(r=>r.status),accountAppliedOnce:true,realConstraintFailureRolledBackPosition:true,retryAppliedOnce:true,walletBalanceNotProjected:true,limits:'Actual source transaction and Prisma schema; not compiled close handler, durable event-journal coverage or full portfolio ROI.'};fs.writeFileSync(out,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
})().catch(e=>{console.error(JSON.stringify({failed:true,code:e.code??'test_assertion',reason:e instanceof assert.AssertionError?e.message:'isolated_database_check_failed'}));process.exitCode=1;}).finally(()=>db.$disconnect());

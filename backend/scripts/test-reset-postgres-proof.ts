import {PrismaClient} from '@prisma/client';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import router from '../src/routes/testnet';
import {insertAccountResetReceipt} from '../src/repositories/account-mutation-journal.repository';
import {buildAccountResetReceipt} from '../src/utils/account-reset-receipt';
const url=process.env.DATABASE_URL;
if(!url||new URL(url).hostname!=='127.0.0.1'||new URL(url).port!=='55439'||new URL(url).pathname!=='/crypto_reset_test')throw Error('Refusing non-isolated DB');
const db=new PrismaClient({datasources:{db:{url}}});
const handler=(router as any).stack.find((l:any)=>l.route?.path==='/reset/:accountId').route.stack[0].handle;
async function call(id:number){const res:any={code:200,status(n:number){this.code=n;return this;},json(v:any){this.body=v;return this;}};await handler({params:{accountId:String(id)},prisma:db},res);return res;}
async function main(){
 const a=await db.testnetAccount.create({data:{symbol:'BTC',method_id:'reset_proof',starting_balance:30,current_balance:29,equity:29,realized_pnl:-1,total_trades:1}});
 async function position(id:string){await db.testnetPosition.create({data:{account_id:a.id,position_id:id,symbol:'BTC',side:'long',entry_price:100,stop_loss:99,take_profit:102,size_usd:100,size_qty:1,risk_usd:1,risk_percent:1,expected_rr:2,status:'closed'}});await db.testnetTradeEvent.create({data:{position_id:id,event_type:'proof'}});}
 await position('proof1');
 await db.$executeRawUnsafe('ALTER TABLE account_mutation_journal RENAME TO unavailable_receipts');
 assert.equal((await call(a.id)).code,500);
 assert.equal(await db.testnetPosition.count({where:{account_id:a.id}}),1);
 assert.equal(await db.testnetTradeEvent.count(),1);
 assert.equal((await db.testnetAccount.findUniqueOrThrow({where:{id:a.id}})).current_balance,29);
 await db.$executeRawUnsafe('ALTER TABLE unavailable_receipts RENAME TO account_mutation_journal');
 assert.equal((await call(a.id)).body.success,true);
 const receipts=()=>db.$queryRawUnsafe<any[]>('SELECT attempt_id, evidence FROM account_mutation_journal ORDER BY recorded_at');
 const first=await receipts();assert.equal(first.length,1);assert.equal(first[0].evidence.exchange_flatness_verified,false);
 assert.equal(await db.testnetPosition.count({where:{account_id:a.id}}),0);
 await position('proof2');assert.equal((await call(a.id)).body.success,true);
 assert.equal((await receipts()).length,2);assert.equal((await receipts())[0].attempt_id,first[0].attempt_id);
 const duplicate=buildAccountResetReceipt(a.id,first[0].attempt_id,30,new Date());
 await assert.rejects(db.$transaction(async tx=>{await tx.testnetAccount.update({where:{id:a.id},data:{current_balance:999}});await insertAccountResetReceipt(tx,duplicate);}));
 assert.equal((await db.testnetAccount.findUniqueOrThrow({where:{id:a.id}})).current_balance,30);assert.equal((await receipts()).length,2);
 writeFileSync(process.argv[2],JSON.stringify({passed:true,isolatedDatabase:true,checks:['missing_table_rolls_back_deletions_and_account_write','committed_receipt_visible','second_reset_preserves_prior_receipt','duplicate_uuid_rolls_back_account_write'],runtimeProductionTouched:false,limits:'Isolated PostgreSQL actual handler; no exchange/economic ROI proof'},null,2),{flag:'wx',mode:0o600});
 console.log('Four isolated PostgreSQL checks passed');
}
main().finally(()=>db.$disconnect()).catch(e=>{console.error(e);process.exitCode=1;});

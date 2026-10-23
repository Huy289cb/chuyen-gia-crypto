import {PrismaClient} from '@prisma/client';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {replayRecordedAccountReset as replay} from '../src/utils/recorded-account-reset';
const url=process.env.DATABASE_URL;if(!url||new URL(url).hostname!=='127.0.0.1'||new URL(url).port!=='55439'||new URL(url).pathname!=='/crypto_reset_test')throw Error('Refusing non-isolated DB');
const db=new PrismaClient({datasources:{db:{url}}});
async function main(){const rows=await db.$queryRawUnsafe<any[]>('SELECT attempt_id,account_id,mutation_kind,evidence,recorded_at FROM account_mutation_journal ORDER BY recorded_at');const knownAt=Date.now();assert.equal(rows.length,2);const serialized=JSON.parse(JSON.stringify(rows));const results=serialized.map((row:any)=>replay(row,knownAt,knownAt));for(const r of results){assert.equal(r.status,'evaluated');assert.equal(r.matches_recorded,true);assert.equal(r.commit_time,null);}writeFileSync(process.argv[2],JSON.stringify({knownAt:new Date(knownAt).toISOString(),rows:serialized,results,productionTouched:false},null,2),{flag:'wx',mode:0o600});console.log('Two committed PostgreSQL receipts replay exactly');}
main().finally(()=>db.$disconnect()).catch(e=>{console.error(e);process.exitCode=1;});

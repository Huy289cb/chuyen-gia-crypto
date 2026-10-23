const fs=require('fs'),path=require('path'),assert=require('assert/strict'),vm=require('vm'),ts=require('typescript'),{PrismaClient}=require('@prisma/client');
const url=process.env.DATABASE_URL;if(!url||new URL(url).hostname!=='127.0.0.1'||new URL(url).port!=='55439'||new URL(url).pathname!=='/crypto_reset_test')throw Error('Refusing non-isolated DB');
const db=new PrismaClient({datasources:{db:{url}}});
function load(file,deps){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{module:m,exports:m.exports,require:id=>{assert.ok(id in deps,id);return deps[id];}});return m.exports;}
(async()=>{const helper=load('utils/provider-journal-record.ts',{});await assert.rejects(db.$transaction(async tx=>{
 const sql=fs.readFileSync(path.join(__dirname,'../sql/provider-request-journal-v1.sql'),'utf8');for(const statement of sql.split(';').filter(s=>s.trim()))await tx.$executeRawUnsafe(statement);
 const repository=load('repositories/provider-journal.repository.ts',{'../lib/prisma':{prisma:tx},'../utils/provider-journal-record':helper});
 const data={request_id:'fixture',provider:'example.invalid',model:'fixture',trace_id:null,provider_purpose:'telegram',cost_usd:null,cost_status:'unknown',headers:{Authorization:'private-fixture'}};
 await repository.insertProviderJournalEvent('llm_provider_request',data);await repository.insertProviderJournalEvent('llm_provider_result',{...data,cost_usd:.01,cost_status:'reported'});
 const rows=await tx.$queryRaw`SELECT request_id,event_type,metadata,recorded_at FROM public.provider_request_journal ORDER BY event_type`;
 assert.equal(rows.length,2);assert.ok(rows.every(r=>r.recorded_at instanceof Date));assert.ok(!JSON.stringify(rows).includes('private-fixture'));
 const fks=await tx.$queryRaw`SELECT conname FROM pg_constraint WHERE conrelid='public.provider_request_journal'::regclass AND contype='f'`;assert.equal(fks.length,0);
 await tx.$executeRawUnsafe('SAVEPOINT duplicate_test');await assert.rejects(repository.insertProviderJournalEvent('llm_provider_result',data));await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT duplicate_test');
 assert.equal((await tx.$queryRaw`SELECT count(*)::int AS n FROM public.provider_request_journal`)[0].n,2);
 throw Error('fixture_rollback');
 },{timeout:30000}),/fixture_rollback/);
 const tables=await db.$queryRaw`SELECT to_regclass('public.provider_request_journal')::text AS name`;assert.equal(tables[0].name,null);
 fs.writeFileSync(process.argv[2],JSON.stringify({passed:true,isolatedDatabase:true,parameterizedSourceRepositoryInserts:2,duplicateRejected:true,noForeignKeys:true,privacyPassed:true,transactionRolledBack:true,productionTouched:false,limits:'Schema/repository evidence; not runtime telemetry wiring, commit durability, reset-handler integration or complete request coverage'},null,2),{flag:'wx',mode:0o600});console.log('Isolated provider journal schema/repository checks passed');})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.$disconnect());

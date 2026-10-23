'use strict';
// One registered real-PostgreSQL clone experiment; no provider or live calls.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {PrismaClient}=require('@prisma/client');
const {prepareStructuralRootEventIndex,INDEX_NAME}=require('./prepare-structural-root-event-index.cjs');
const repo=path.resolve(__dirname,'../..'),audit=path.join(repo,'docs/audits/2026-10-09-structural-root-index'),out=path.join(audit,'paged-verification');
if(fs.existsSync(out))throw Error('NEW_PAGED_OUTPUT_REQUIRED');fs.mkdirSync(out,{mode:0o700});
const registration=JSON.parse(fs.readFileSync(path.join(audit,'paged-verification-registration.json')));
const result={version:'structural-root-query-index-paged-test-v2',started_at_utc:new Date().toISOString(),provider_calls:0,source_schema:registration.source_schema,test_schema:registration.test_schema,queries:[],checks:[],status:'running'};
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const check=(name)=>{result.checks.push({name,outcome:'PASS'});console.log('PASS '+name);};
let db;
async function sql(client,kind,query,args=[]){assert.ok(Date.now()+10000<Date.parse(registration.registered_at)+registration.max_wall_seconds*1000,'registered wall cutoff: no further DB statement');const start=performance.now();try{const value=await client[kind](query,...args);result.queries.push({query,query_sha256:sha(query),arguments:args,client_elapsed_ms:performance.now()-start,status:'ok'});return value;}catch(error){result.queries.push({query,query_sha256:sha(query),arguments:args,client_elapsed_ms:performance.now()-start,status:'error',code:error.code??null,message:error.message});throw error;}}
const execute=(query,args)=>sql(db,'$executeRawUnsafe',query,args);
const query=(query,args)=>sql(db,'$queryRawUnsafe',query,args);
const q=s=>{assert.match(s,/^engine_[a-zA-Z0-9_]+$/);return '"'+s+'"';};
const table=s=>q(s)+'."testnet_trade_events"';
const where=`"position_id" = 'pipeline_v3_kim_nghia' AND "event_type" IN ('structural_root_observed','structural_root_expired','structural_root_child_observed')`;
const columns='"id","position_id","event_type","event_data","timestamp"';
const select=s=>`SELECT ${columns} FROM ${table(s)} WHERE ${where} ORDER BY "id" ASC`;
const hashRows=rows=>{const h=crypto.createHash('sha256');for(const row of rows)h.update(JSON.stringify(row)+'\n');return h.digest('hex');};
async function digest(s){
 const start=performance.now(),h=crypto.createHash('sha256');let cursor=null,count=0;
 const measurement={schema:s,run_number:(result.digest_pages??=[]).length+1,page_size:2000,max_pages:100,pages:[]};result.digest_pages.push(measurement);
 for(let page=1;page<=100;page++){
  const sqlText=`SELECT id,md5(row_to_json(t)::text) AS row_md5 FROM ${table(s)} t ${cursor===null?'':'WHERE id > $1'} ORDER BY id ASC LIMIT 2000`;
  const tick=performance.now(),rows=await query(sqlText,cursor===null?[]:[cursor]);
  for(const row of rows){assert.ok(Number.isInteger(row.id),'integer primary key required');assert.ok(cursor===null||row.id>cursor,'strict ascending primary keys required');assert.match(row.row_md5,/^[a-f0-9]{32}$/);h.update(`${row.id}:${row.row_md5}\n`);cursor=row.id;count++;}
  measurement.pages.push({page,row_count:rows.length,last_id:cursor,client_elapsed_ms:performance.now()-tick,memory_usage:process.memoryUsage()});
  if(rows.length<2000){measurement.total_client_elapsed_ms=performance.now()-start;measurement.row_count=count;return{row_count:String(count),all_rows_ordered_sha256:h.digest('hex')};}
 }
 throw Error('registered_digest_page_cutoff');
}
async function indexes(s){const rows=await query(`SELECT c.relname AS index_name,pg_get_indexdef(i.indexrelid) AS definition,jsonb_build_object('method',am.amname,'unique',i.indisunique,'primary',i.indisprimary,'valid',i.indisvalid,'ready',i.indisready,'keys',ARRAY(SELECT pg_get_indexdef(i.indexrelid,k,true) FROM generate_series(1,i.indnatts) k),'predicate',pg_get_expr(i.indpred,i.indrelid)) AS signature FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am am ON am.oid=c.relam WHERE i.indrelid=to_regclass($1) ORDER BY c.relname`,[s+'.testnet_trade_events']);return rows;}
const signatures=rows=>rows.map(row=>JSON.stringify(row.signature)).sort();
async function timedTransaction(s){const start=performance.now();const data=await db.$transaction(async tx=>{await sql(tx,'$executeRawUnsafe','SELECT pg_advisory_xact_lock(hashtext($1))',['pipeline_v3_kim_nghia']);return await sql(tx,'$queryRawUnsafe',select(s));},{maxWait:10000,timeout:10000});return{client_transaction_elapsed_ms:performance.now()-start,row_count:data.length,ordered_result_sha256:hashRows(data)};}
async function explain(s){const rows=await query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+select(s));return rows[0]['QUERY PLAN'];}
(async()=>{
 assert.equal(sha(fs.readFileSync(path.join(__dirname,'test-structural-root-event-index.cjs'))),registration.original_test_script_sha256);assert.equal(sha(fs.readFileSync(path.join(__dirname,'prepare-structural-root-event-index.cjs'))),registration.installer_sha256);
 result.original_failure_sha256=sha(fs.readFileSync(path.join(audit,'result.json')));
 result.source_before=Object.fromEntries(Object.entries(registration.source_before).map(([name,expected])=>{const actual=sha(fs.readFileSync(path.join(repo,name)));assert.equal(actual,expected);return[name,actual];}));
 let mockCalls=0;const guarded={ $queryRawUnsafe:async()=>{mockCalls++;return[];},$executeRawUnsafe:async()=>{mockCalls++;return0;} };
 for(const schema of ['public','production','engine_bad-name','engine_bad";DROP SCHEMA public;--',''])await assert.rejects(prepareStructuralRootEventIndex({database:guarded,storageSchema:schema}),/explicit_isolated_structural_root_schema_required/);
 assert.equal(mockCalls,0);check('malformed and production schemas refused before database calls');
 const environment=JSON.parse(cp.execFileSync('docker',['inspect','--format','{{json .Config.Env}}','roi-close-atomic-test-20261003'],{encoding:'utf8'}));
 const privateEnv=Object.fromEntries(environment.map(value=>{const i=value.indexOf('=');return[value.slice(0,i),value.slice(i+1)];}));
 assert.ok(privateEnv.POSTGRES_USER);assert.ok(privateEnv.POSTGRES_PASSWORD);
 const uri=new URL('postgresql://127.0.0.1:55439/crypto_reset_test');uri.username=privateEnv.POSTGRES_USER;uri.password=privateEnv.POSTGRES_PASSWORD;uri.searchParams.set('connection_limit','1');uri.searchParams.set('pool_timeout','10');
 db=new PrismaClient({datasources:{db:{url:uri.toString()}}});
 await execute("SET statement_timeout = '10000ms'");
 const exists=await query('SELECT 1 FROM pg_namespace WHERE nspname=$1',[registration.test_schema]);assert.equal(exists.length,0,'fresh test namespace required; no destructive reset');
 result.source_before_digest=await digest(registration.source_schema);result.source_before_indexes=await indexes(registration.source_schema);
 await execute('CREATE SCHEMA '+q(registration.test_schema));
 await execute(`CREATE TABLE ${table(registration.test_schema)} (LIKE ${table(registration.source_schema)} INCLUDING ALL)`);
 await execute(`INSERT INTO ${table(registration.test_schema)} (${columns}) SELECT ${columns} FROM ${table(registration.source_schema)}`);
 await execute('ANALYZE '+table(registration.test_schema));
 result.clone_before_digest=await digest(registration.test_schema);result.clone_before_indexes=await indexes(registration.test_schema);
 assert.deepEqual(result.clone_before_digest,result.source_before_digest);assert.deepEqual(signatures(result.clone_before_indexes),signatures(result.source_before_indexes));check('clone all row count/hash and original index definitions equal source');
 await execute(`CREATE INDEX "${INDEX_NAME}" ON ${table(registration.test_schema)} USING btree ("position_id","id")`);
 const beforeWrong=await indexes(registration.test_schema);let rejected=false;
 try{await prepareStructuralRootEventIndex({database:{$queryRawUnsafe:(s,...args)=>query(s,args),$executeRawUnsafe:(s,...args)=>execute(s,args)},storageSchema:registration.test_schema});}catch(error){assert.match(error.message,/structural_root_index_definition_mismatch/);result.expected_definition_refusal=error.message;rejected=true;}
 assert.ok(rejected);assert.deepEqual(await indexes(registration.test_schema),beforeWrong);check('wrong existing definition refused without index or data mutation');
 await execute(`DROP INDEX ${q(registration.test_schema)}."${INDEX_NAME}"`);
 // A single warm-up, then one measured EXPLAIN and transaction per arm; no rerun for gain.
 const warmBefore=await query(select(registration.test_schema));result.before_warmup={row_count:warmBefore.length,ordered_result_sha256:hashRows(warmBefore)};
 result.before_explain=await explain(registration.test_schema);result.before_transaction=await timedTransaction(registration.test_schema);
 const adapter={$queryRawUnsafe:(s,...args)=>query(s,args),$executeRawUnsafe:(s,...args)=>execute(s,args)};
 result.installer_first=await prepareStructuralRootEventIndex({database:adapter,storageSchema:registration.test_schema});assert.equal(result.installer_first.created,true);
 const installerStart=result.queries.length;result.installer_second=await prepareStructuralRootEventIndex({database:adapter,storageSchema:registration.test_schema});assert.equal(result.installer_second.created,false);assert.equal(result.queries.length-installerStart,1);check('valid composite index installed once and repeat is verified read-only idempotence');
 const warmAfter=await query(select(registration.test_schema));result.after_warmup={row_count:warmAfter.length,ordered_result_sha256:hashRows(warmAfter)};
 result.after_explain=await explain(registration.test_schema);result.after_transaction=await timedTransaction(registration.test_schema);
 assert.deepEqual(result.after_warmup,result.before_warmup);assert.equal(result.after_transaction.ordered_result_sha256,result.before_transaction.ordered_result_sha256);assert.equal(result.after_transaction.row_count,result.before_transaction.row_count);check('ordered actual query results and hash unchanged');
 result.clone_after_digest=await digest(registration.test_schema);result.clone_after_indexes=await indexes(registration.test_schema);result.source_after_digest=await digest(registration.source_schema);result.source_after_indexes=await indexes(registration.source_schema);
 assert.deepEqual(result.clone_after_digest,result.clone_before_digest);assert.deepEqual(result.source_after_digest,result.source_before_digest);assert.deepEqual(result.source_after_indexes,result.source_before_indexes);
 assert.deepEqual(signatures(result.clone_after_indexes.filter(x=>x.index_name!==INDEX_NAME)),signatures(result.clone_before_indexes));check('all clone rows and old indexes unchanged; retained source untouched');
 for(const[name,expected]of Object.entries(registration.source_before))assert.equal(sha(fs.readFileSync(path.join(repo,name))),expected);
 check('registered original source files unchanged');
 result.new_source_sha256=Object.fromEntries(['prepare-structural-root-event-index.cjs','run-causal-range-scheduler-integration-indexed-strict-db-phases.cjs','test-structural-root-event-index-paged.cjs'].map(name=>[name,sha(fs.readFileSync(path.join(__dirname,name)))]));
 result.status='passed';
})().catch(error=>{result.status='failed';result.failure={message:error.message,code:error.code??null};process.exitCode=1;console.error(error.message);}).finally(async()=>{
 if(db)await db.$disconnect();result.completed_at_utc=new Date().toISOString();fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,(_key,value)=>typeof value==='bigint'?value.toString():value,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({status:result.status,checks:result.checks.length,provider_calls:0,before_execution_ms:result.before_explain?.[0]?.['Execution Time'],after_execution_ms:result.after_explain?.[0]?.['Execution Time'],before_transaction_ms:result.before_transaction?.client_transaction_elapsed_ms,after_transaction_ms:result.after_transaction?.client_transaction_elapsed_ms}));
});

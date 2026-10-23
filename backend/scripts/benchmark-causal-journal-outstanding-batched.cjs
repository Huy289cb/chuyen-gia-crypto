'use strict';
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path'),{performance}=require('node:perf_hooks'),{PrismaClient}=require('@prisma/client');
const {createPortfolioCommandJournal}=require('./portfolio-command-journal-outstanding.cjs');
const c=JSON.parse(cp.execFileSync('docker',['inspect','roi-close-atomic-test-20261003'],{encoding:'utf8'}))[0];
const e=Object.fromEntries(c.Config.Env.map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)]}));
if(c.NetworkSettings.Ports['5432/tcp'][0].HostPort!=='55439'||c.NetworkSettings.Ports['5432/tcp'][0].HostIp!=='127.0.0.1')throw Error('isolated_only');
const out=path.resolve(__dirname,'../../docs/audits/2026-10-07-journal-throughput/outstanding-batched-scale.json');if(fs.existsSync(out))throw Error('new_artifact_required');
const report={scope:'synthetic isolated journal performance; not runtime or economic portfolio',status:'running',passed:false,wall_started_at:Date.now(),samples:[]};
const save=()=>fs.writeFileSync(out,JSON.stringify(report,null,2));let db,stopped=false;
process.on('SIGTERM',()=>{stopped=true;report.stop='SIGTERM';save();});
const check=()=>{if(stopped||Date.now()-report.wall_started_at>=175000)throw Error('registered_wall_cutoff');};
(async()=>{
for(const size of [10000,100000]){
check();const schema='engine_journal_outstanding_'+size+'_batch128_20261007',table='"'+schema+'".testnet_trade_events';
const u=new URL(`postgresql://${encodeURIComponent(e.POSTGRES_USER)}:${encodeURIComponent(e.POSTGRES_PASSWORD)}@127.0.0.1:55439/crypto_reset_test`);u.searchParams.set('schema',schema);u.searchParams.set('connection_limit','1');
db=new PrismaClient({datasources:{db:{url:u.toString()}}});await db.$executeRawUnsafe("SET statement_timeout='5s'");
await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);await db.$executeRawUnsafe(`CREATE TABLE ${table}(id SERIAL PRIMARY KEY,position_id text NOT NULL,event_type text NOT NULL,event_data text,"timestamp" timestamp NOT NULL DEFAULT now())`);
const sample={historical_pairs:size,seeded_pairs:0,pair_samples_ms:[]};report.samples.push(sample);save();
for(let from=1;from<=size;from+=128){check();await db.$executeRawUnsafe(`INSERT INTO ${table}(position_id,event_type,event_data) SELECT 'scale',e.kind,'{"command_key":"seed-'||g||'"}' FROM generate_series($1::int,$2::int)g CROSS JOIN (VALUES('portfolio_command_started'),('portfolio_command_completed'))e(kind)`,from,Math.min(size,from+127));sample.seeded_pairs=Math.min(size,from+127);save();}
await db.$executeRawUnsafe(`ANALYZE ${table}`);const journal=createPortfolioCommandJournal({database:db,positionId:'scale',storageSchema:schema});
const preparation=performance.now();await journal.prepare();sample.prepare_ms=performance.now()-preparation;save();
for(let i=0;i<20;i++){check();const start=performance.now(),at=Date.UTC(2025,1,1)+i*60000;const key=await journal.begin({kind:'scale',at});await journal.complete({command_key:key,kind:'scale',at,operations:[]});sample.pair_samples_ms.push(performance.now()-start);save();}
const sorted=[...sample.pair_samples_ms].sort((a,b)=>a-b);sample.p50_ms=sorted[9];sample.p95_ms=sorted[18];sample.max_ms=sorted[19];sample.gaps=(await journal.gaps()).length;save();await db.$disconnect();db=null;
}
report.passed=report.samples.every(s=>s.gaps===0&&s.pair_samples_ms.length===20)&&report.samples.at(-1).p95_ms<=250;report.status=report.passed?'passed':'performance_gate_failed';
})().catch(e=>{report.status='failed';report.failure=e.message;process.exitCode=1}).finally(async()=>{if(db)await db.$disconnect();report.wall_seconds=(Date.now()-report.wall_started_at)/1000;save();console.log(JSON.stringify(report));});

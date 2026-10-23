'use strict';
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path'),{PrismaClient}=require('@prisma/client');
const c=JSON.parse(cp.execFileSync('docker',['inspect','roi-close-atomic-test-20261003'],{encoding:'utf8'}))[0];
const e=Object.fromEntries(c.Config.Env.map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)]}));
if(c.NetworkSettings.Ports['5432/tcp'][0].HostPort!=='55439')throw Error('isolated_only');
const u=new URL(`postgresql://${encodeURIComponent(e.POSTGRES_USER)}:${encodeURIComponent(e.POSTGRES_PASSWORD)}@127.0.0.1:55439/crypto_reset_test`);
const db=new PrismaClient({datasources:{db:{url:u.toString()}}});
(async()=>{
await db.$executeRawUnsafe("SET statement_timeout='5s'");
const table='"engine_journal_scale_20261007".testnet_trade_events';
const plan=await db.$queryRawUnsafe(`EXPLAIN (FORMAT JSON) SELECT s.event_data FROM ${table} s WHERE s.position_id=$1 AND s.event_type='portfolio_command_started' AND NOT EXISTS(SELECT 1 FROM ${table} c WHERE c.position_id=s.position_id AND c.event_type='portfolio_command_completed' AND c.event_data::jsonb->>'command_key'=s.event_data::jsonb->>'command_key')`,'scale');
const state=await db.$queryRawUnsafe(`SELECT event_type,count(*)::text AS rows FROM ${table} GROUP BY event_type`);
const indexes=await db.$queryRawUnsafe("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='engine_journal_scale_20261007'");
const active=await db.$queryRawUnsafe("SELECT pid,state,wait_event_type,wait_event,left(query,300) AS query FROM pg_stat_activity WHERE datname='crypto_reset_test' AND state<>'idle' AND pid<>pg_backend_pid()");
const report={plan,state,indexes,active};fs.writeFileSync(path.resolve(__dirname,'../../docs/audits/2026-10-07-journal-throughput/query-plan.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>db.$disconnect());

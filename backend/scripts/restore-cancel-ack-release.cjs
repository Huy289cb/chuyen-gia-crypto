// Recover the previously saved app set after a reboot, with a sealed verified overlay.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),pkg=path.resolve(process.argv[2]||''),out=path.resolve(process.argv[3]||'');
if(!process.argv[2]||!process.argv[3]||fs.existsSync(out))throw Error('Usage: PACKAGE NEW_REPORT');
const dumpPath='/home/ubuntu/.pm2/dump.pm2',dumpBytes=fs.readFileSync(dumpPath),dump=JSON.parse(dumpBytes),names=['crypto-api','crypto-worker','crypto-post-exit'];
if(dump.length!==3||names.some(n=>!dump.some(a=>a.name===n)))throw Error('unexpected_saved_app_set');
const target=path.join(root,'dist'),saved=names.map(n=>dump.find(a=>a.name===n));
if(saved.some(a=>path.dirname(a.pm_exec_path)!==target))throw Error('unexpected_saved_entrypoint');
const pinned={MAX_EFFECTIVE_RISK_PER_TRADE_USD:'',MAX_EFFECTIVE_RISK_PER_TRADE_PERCENT:'3',DAILY_LOSS_LIMIT_PERCENT:'10',MIN_SL_DISTANCE_PERCENT:'0.008',RISK_PER_TRADE_PERCENT:'0.5',MAX_TOTAL_EXPOSURE_USD:'100',POST_CLOSE_SAME_SIDE_COOLDOWN_MINUTES:'60',POST_LOSS_SAME_SIDE_COOLDOWN_MINUTES:'60',PENDING_ORDER_REENTRY_COOLDOWN_MINUTES:'60',CONSECUTIVE_LOSS_COOLDOWN_HOURS:'1',LOSS_COOLDOWN_TIER2_HOURS:'1',LOSS_COOLDOWN_TIER3_HOURS:'1',LOSS_COOLDOWN_TIER3_UNTIL_UTC_DAY:'false',CIRCUIT_EXPECTANCY_COOLDOWN_HOURS:'1'};
for(const app of saved.slice(0,2))for(const [k,v]of Object.entries(pinned))if((app[k]??app.env?.[k])!==v)throw Error('saved_policy_mismatch:'+k);
const pm2=(...args)=>cp.execFileSync('pm2',args,{encoding:'utf8',timeout:45000});
if(JSON.parse(pm2('jlist')).length)throw Error('apps_already_running');
const m=JSON.parse(fs.readFileSync(path.join(pkg,'manifest.json')));
if(JSON.stringify(m.changedFiles)!==JSON.stringify(['services/binance/trading.js','services/pending-order-actions.js']))throw Error('unexpected_package');
const control=command=>JSON.parse(cp.execFileSync('python3',[path.join(__dirname,'measurement-release-control.py'),command,'--package',pkg,...(['apply','rollback','preflight'].includes(command)?['--target',target]:[])],{encoding:'utf8',timeout:45000}));
control('verify');const pre=control('preflight');if(!pre.targetMatchesBaseline||!pre.stopped)throw Error('target_not_stopped_baseline');
Object.assign(process.env,saved[1].env??{},Object.fromEntries(Object.entries(saved[1]).filter(([,v])=>typeof v==='string')));
const {get}=require(path.join(target,'services/binance/client')), {endpoints}=require(path.join(target,'services/binance/endpoints')), {prisma}=require(path.join(target,'lib/prisma'));
const report={startedAt:new Date().toISOString(),hostname:cp.execFileSync('hostname',{encoding:'utf8'}).trim(),bootId:fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),savedDumpSha256:crypto.createHash('sha256').update(dumpBytes).digest('hex'),package:pkg,policy:pinned,deployed:false,appsRestored:false};let applied=false,started=false;
async function flat(){
 const [positions,orders,algo,dbPositions,dbPending]=await Promise.all([get('/fapi/v2/positionRisk',{symbol:'BTCUSDT'},true),get('/fapi/v1/openOrders',{symbol:'BTCUSDT'},true),get(endpoints.OPEN_ALGO_ORDERS,{symbol:'BTCUSDT'},true),prisma.testnetPosition.count({where:{symbol:'BTC',status:{in:['open','reconciliation_failed_not_on_binance']}}}),prisma.testnetPendingOrder.count({where:{symbol:'BTC',status:{in:['pending','partially_filled','reconciliation_failed_not_on_binance']}}})]);
 const algos=Array.isArray(algo)?algo:algo?.orders;if(!Array.isArray(positions)||!Array.isArray(orders)||!Array.isArray(algos)||positions.some(p=>!Number.isFinite(Number(p.positionAmt))))throw Error('unknown_exchange_state');
 const open=positions.filter(p=>p.symbol==='BTCUSDT'&&Number(p.positionAmt)!==0).length;
 if(open||orders.length||algos.length||dbPositions||dbPending)throw Error('account_not_flat');return {at:new Date().toISOString(),positions:open,orders:orders.length,algoOrders:algos.length,dbPositions,dbPending};
}
(async()=>{
 report.before=await flat();if(JSON.parse(pm2('jlist')).length)throw Error('apps_started_during_checks');
 report.apply=control('apply');applied=true;pm2('resurrect');started=true;
 const apps=JSON.parse(pm2('jlist'));report.apps=names.map(n=>{const a=apps.find(x=>x.name===n);if(!a?.pid||a.pm2_env.status!=='online')throw Error('restore_failed');
 const env=Object.fromEntries(fs.readFileSync('/proc/'+a.pid+'/environ','utf8').split('\0').filter(s=>s.includes('=')).map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];}));
 if(n!=='crypto-post-exit')for(const [k,v]of Object.entries(pinned))if(env[k]!==v)throw Error('restored_policy_mismatch:'+k);return {name:n,pid:a.pid,status:a.pm2_env.status};});
 report.deployed=true;report.appsRestored=true;report.completedAt=new Date().toISOString();pm2('save');
})().catch(e=>{report.error=e.message?.startsWith('Command failed')?'command_failed':e.message;if(applied){if(started)pm2('stop',...names);report.rollback=control('rollback');pm2('resurrect');}process.exitCode=1;}).finally(async()=>{await prisma.$disconnect();fs.writeFileSync(out,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({deployed:report.deployed,appsRestored:report.appsRestored,error:report.error,report:out}));});

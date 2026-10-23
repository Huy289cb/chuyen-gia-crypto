// GET-only observations and SELECT-only DB knowledge clock; never repairs/orders.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');require('tsx/cjs');
const {captureAlgoContractEvidence}=require('../src/utils/algo-contract-evidence.ts');
const out=process.argv[2];if(!out||fs.existsSync(out))throw Error('Usage: NEW_EXPORT');
const worker=JSON.parse(cp.execFileSync('pm2',['jlist'],{encoding:'utf8'})).find(a=>a.name==='crypto-worker');
if(!worker?.pid||worker.pm2_env.status!=='online')throw Error('worker_unavailable');
Object.assign(process.env,Object.fromEntries(fs.readFileSync('/proc/'+worker.pid+'/environ','utf8').split('\0').filter(Boolean).map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];})));
const build=path.dirname(worker.pm2_env.pm_exec_path),{get}=require(path.join(build,'services/binance/client')),{endpoints}=require(path.join(build,'services/binance/endpoints')),{prisma}=require(path.join(build,'lib/prisma'));
const allowed=new Set(['/fapi/v2/positionRisk',endpoints.OPEN_ALGO_ORDERS]);
const primitive=v=>typeof v==='boolean'||typeof v==='string'&&v.length<=256||typeof v==='number'&&Number.isFinite(v)?v:null;
async function observe(endpoint,kind){
 if(!allowed.has(endpoint))throw Error('endpoint_not_allowed');const started_at=new Date().toISOString();
 try{
  const response=await get(endpoint,{symbol:'BTCUSDT'},true),received_at=new Date().toISOString();
  const rows=Array.isArray(response)?response:kind==='orders'&&Array.isArray(response?.orders)?response.orders:null;
  if(!rows||rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))return {status:'unknown',reason:'invalid_response_shape',started_at,received_at};
  const data=kind==='orders'?rows.map(row=>captureAlgoContractEvidence(null,row).response):rows.map(row=>Object.fromEntries(['symbol','positionSide','positionAmt','entryPrice','markPrice','updateTime'].map(k=>[k,primitive(row[k])])));
  return {status:'observed',started_at,received_at,endpoint,rows:data};
 }catch{return {status:'unknown',reason:'query_failed',started_at,received_at:new Date().toISOString()};}
}
(async()=>{
 const [positions,orders]=await Promise.all([observe('/fapi/v2/positionRisk','positions'),observe(endpoints.OPEN_ALGO_ORDERS,'orders')]);
 const known_at=await prisma.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');const [clock]=await tx.$queryRawUnsafe('SELECT CURRENT_TIMESTAMP AS cutoff');return new Date(clock.cutoff).toISOString();},{isolationLevel:'RepeatableRead'});
 const report={schema:'protection-state-observation-v1',symbol:'BTCUSDT',known_at,positions,orders,collector_sha256:crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),limits:'Separate observation times; not atomic exchange state, historical fills, portfolio parity or ROI evidence.'};
 fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({known_at,positions:positions.status,position_rows:positions.rows?.length??null,orders:orders.status,order_rows:orders.rows?.length??null}));
})().catch(e=>{console.error('protection_capture_failed:'+e.constructor.name);process.exitCode=1;}).finally(()=>prisma.$disconnect());

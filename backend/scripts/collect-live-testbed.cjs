require('dotenv').config({quiet:true});const fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process');
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'../docs/audits/2026-09-24-live-testbed');fs.mkdirSync(out,{recursive:true});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 const {getServerTime,getKlines}=require('../dist/services/binance/market'),{get}=require('../dist/services/binance/client');
 let protocol;
 if(fs.existsSync(out+'/protocol.json'))protocol=JSON.parse(fs.readFileSync(out+'/protocol.json'));
 else{
  const server=await getServerTime(),end=Math.floor(server/300000)*300000,start=end-60*86400000,warmup=Math.floor((start-26*86400000)/14400000)*14400000;
  const apps=JSON.parse(cp.execFileSync('pm2',['jlist'],{encoding:'utf8'})),worker=apps.find(p=>p.name==='crypto-worker');if(!worker)throw Error('No live worker');
  const env=Object.fromEntries(fs.readFileSync('/proc/'+worker.pid+'/environ','utf8').split('\0').filter(Boolean).map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)]}));
  const policyEnv=Object.fromEntries(Object.entries(env).filter(([k])=>/^(V3_|TRANSITION_|RANGE_|ADAPTIVE_|FUNDING_|CLOSED_|MIN_|MAX_|RISK_|DAILY_|POST_|LOSS_|CONSECUTIVE_|CIRCUIT_|PROFIT_|INVALIDATION_|SIGNAL_GATE_|PENDING_ORDER_|GROQ_.*MODEL|OPENROUTER_.*MODEL|CEREBRAS_.*MODEL|LLM_)/.test(k)&&!/KEY|TOKEN|SECRET|PASSWORD|URL/.test(k)));
  fs.cpSync(root+'/dist',out+'/dist',{recursive:true});fs.symlinkSync(root+'/node_modules',out+'/node_modules','dir');
  const hashes={};function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(e.name.endsWith('.js'))hashes[path.relative(out+'/dist',p)]=sha(fs.readFileSync(p));}}walk(out+'/dist');
  protocol={version:'deployed-module-testbed-v1',frozenAt:new Date().toISOString(),start,end,warmup,workerPid:worker.pid,policyEnv,hashes,wallet:31.47744546,
   variants:['current_range_long','long_2R','swap_short_0.5R'],scope:'Current deployed MarketScan -> funnel -> stateful retest -> current dispatch validation with fresh AI review. Common regenerated candidate/AI stream, fixed empty historical memory; no production outcomes reused. Synthetic chronological portfolio per variant; same capital/cost/admission. Recent60d market, not old executed trades. No claim of exchange fill/queue or whole multi-lane system parity.'};
  fs.writeFileSync(out+'/protocol.json',JSON.stringify(protocol,null,2),{flag:'wx'});
 }
 const dir=out+'/pages';fs.mkdirSync(dir,{recursive:true});const bars=[];
 for(let cursor=protocol.warmup;cursor<protocol.end;){const file=dir+'/'+cursor+'.json';let page;
  if(fs.existsSync(file))page=JSON.parse(fs.readFileSync(file));else{const k=await getKlines('BTCUSDT','1m',1500,cursor,protocol.end-1);page=k.map(b=>[b.openTime,b.open,b.high,b.low,b.close,b.volume]);if(!page.length)throw Error('empty page');fs.writeFileSync(file,JSON.stringify(page));}
  for(const b of page){if(b[0]>=protocol.end)continue;if(b[0]!==cursor)throw Error('minute gap');bars.push(b);cursor+=60000;}
  if(bars.length%15000===0)console.log('minutes '+bars.length);
 }
 const byTf={'1m':bars};for(const [tf,n]of Object.entries({'5m':5,'15m':15,'1h':60,'4h':240})){const result=[];for(let i=0;i<bars.length;i++){if(bars[i][0]%(n*60000))continue;const a=bars.slice(i,i+n);if(a.length!==n)break;result.push([a[0][0],a[0][1],Math.max(...a.map(b=>b[2])),Math.min(...a.map(b=>b[3])),a.at(-1)[4],a.reduce((s,b)=>s+b[5],0)]);i+=n-1;}byTf[tf]=result;}
 const raw=await get('/fapi/v1/fundingRate',{symbol:'BTCUSDT',startTime:protocol.warmup-86400000,endTime:protocol.end,limit:1000});if(!Array.isArray(raw))throw Error('invalid funding');const funding=raw.map(f=>({time:f.fundingTime,rate:Number(f.fundingRate),markPrice:Number(f.markPrice)}));
 const bytes=JSON.stringify({byTf,funding});fs.writeFileSync(out+'/market.json',bytes);fs.writeFileSync(out+'/market-manifest.json',JSON.stringify({sha256:sha(bytes),rows:Object.fromEntries(Object.entries(byTf).map(([tf,bs])=>[tf,bs.length])),funding:funding.length},null,2));console.log('market frozen');
})().catch(e=>{console.error(e.message);process.exitCode=1});

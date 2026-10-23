/* Deployed modules, historical clock, in-memory persistence; trading adapters cannot load. */
require('dotenv').config({quiet:true});const fs=require('fs'),path=require('path'),crypto=require('crypto'),Module=require('module');
const out=path.resolve(__dirname,'../../docs/audits/2026-09-24-live-testbed'),dist=out+'/dist',read=p=>JSON.parse(fs.readFileSync(p)),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const protocol=read(out+'/protocol.json'),data=read(out+'/market.json');if(sha(fs.readFileSync(out+'/market.json'))!==read(out+'/market-manifest.json').sha256)throw Error('market changed');
if(process.argv.includes('--require-live-parity')){
 const result=require('node:child_process').spawnSync(process.execPath,[path.join(__dirname,'check-live-testbed-parity.cjs'),out+'/protocol.json'],{encoding:'utf8'});
 if(result.status!==0)throw Error('Current-live parity failed; archived experiment cannot represent current runtime. '+result.stdout);
}
for(const [f,h]of Object.entries(protocol.hashes))if(sha(fs.readFileSync(dist+'/'+f))!==h)throw Error('snapshot changed');
for(const k of Object.keys(process.env))if(/^(V3_|TRANSITION_|RANGE_|ADAPTIVE_|FUNDING_|CLOSED_|MIN_|MAX_|RISK_|DAILY_|POST_|LOSS_|CONSECUTIVE_|CIRCUIT_|PROFIT_|INVALIDATION_|SIGNAL_GATE_|PENDING_ORDER_)/.test(k))delete process.env[k];Object.assign(process.env,protocol.policyEnv);
const NativeDate=Date;let clock=protocol.start;global.Date=class extends NativeDate{constructor(...a){super(...(a.length?a:[clock]));}static now(){return clock;}};
const log=console.log;console.log=()=>{};const failures=[];console.warn=(...a)=>failures.push(a.map(String).join(' '));console.error=console.warn;
const durations={'1m':60000,'5m':300000,'15m':900000,'1h':3600000,'4h':14400000};const byTf=Object.fromEntries(Object.entries(data.byTf).map(([tf,bs])=>[tf,bs.map(b=>({timestamp:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]}))]));
let reads=0,maxFutureRead=0,fi=0,id=0;const events=[],dedup=new Set(),counts={},reviews=[],opportunities=[];
function candles(tf,limit=150){const bs=byTf[tf];if(!bs)throw Error('unsupported tf '+tf);let lo=0,hi=bs.length;while(lo<hi){const m=(lo+hi)>>>1;if(bs[m].timestamp+durations[tf]+5000<=clock)lo=m+1;else hi=m;}const selected=bs.slice(Math.max(0,lo-limit),lo);reads++;for(const b of selected)maxFutureRead=Math.max(maxFutureRead,b.timestamp+durations[tf]+5000-clock);return selected;}
const repository={getOrCreateTestnetAccount:async()=>({id:1,current_balance:protocol.wallet,equity:protocol.wallet,starting_balance:protocol.wallet}),getSilentPipelineEvents:async()=>[],hasSilentPipelineEventKey:async(t,f,k)=>dedup.has(t+':'+f+':'+k),recordSilentPipelineEvent:async(type,value)=>{counts[type]=(counts[type]||0)+1;for(const f of ['observation_key','candidate_key','bar_key'])if(value?.[f])dedup.add(type+':'+f+':'+value[f]);const n=++id;if(type.startsWith('transition_')||type.startsWith('llm_')||type==='entry_trace')events.push({id:n,type,at:clock,value:JSON.parse(JSON.stringify(value))});return n;}};
const memory={findDecisionForBar:async()=>null,buildContextForLLM:async()=>({similar_trades:[],recent_failures:[],playbook_stats:{total_trades:0,win_rate:0,avg_rr:0,avg_pnl:0},current_winrate:0}),formatContextForPrompt:()=> 'TESTBED MEMORY: fresh common account, no prior trade outcomes. Do not infer historical results.',formatRecentReflectionsForPrompt:async()=>'',storeDecision:async x=>({id:++id,...x})};
const adapters={
 'services/candle.service':{getCandles:async({timeframe,limit})=>({candles:candles(timeframe,Math.max(1,(limit??100)-1)),source:'frozen-testbed-binance-closed-window'})},
 'repositories/testnet.repository':repository,'utils/scheduler-heartbeat':{recordSchedulerRun:()=>{}},
 'services/ict-shadow-funnel.service':{isIctShadowFunnelEnabled:()=>false,recordIctShadowFunnel:async()=>null},
 'services/v3-entry-eligibility.service':{canRunLlmDispatchForSymbol:async()=>({allowed:true,reason:'Common candidate inventory; admission evaluated per variant'})},
 'services/account-risk-guard.service':{assertTestnetAccountCanOpenTrade:async()=>({allowed:true})},
 'services/memory.service':{memoryService:memory},
 'services/binance/market':{getPremiumIndex:async()=>{while(fi+1<data.funding.length&&data.funding[fi+1].time<=clock)fi++;const f=data.funding[fi];if(!f||f.time>clock)throw Error('funding not yet known');return {lastFundingRate:f.rate,markPrice:candles('1m',1).at(-1).close};}}
};
const originalLoad=Module._load;Module._load=function(request,parent){let resolved;try{resolved=Module._resolveFilename(request,parent);}catch{return originalLoad.apply(this,arguments);}if(typeof resolved==='string'&&resolved.startsWith(dist+'/')){const key=path.relative(dist,resolved).replace(/\.js$/,'');if(adapters[key])return adapters[key];if(key.startsWith('repositories/')||key==='lib/prisma'||/binance\/(client|trading)$/.test(key)||key==='services/v3-trade-execution.service')throw Error('Forbidden external module '+key);}return originalLoad.apply(this,arguments);};
const nativeFetch=global.fetch;fs.mkdirSync(out+'/llm-cache',{recursive:true});const requestLog=[],seenRequests=new Map();
global.fetch=async(url,options={})=>{const host=new URL(String(url)).hostname;if(!['api.groq.com','openrouter.ai','api.cerebras.ai'].includes(host))throw Error('Forbidden network host '+host);const baseKey=sha(String(url)+'\n'+String(options.body||'')),attempt=seenRequests.get(baseKey)||0;seenRequests.set(baseKey,attempt+1);const key=baseKey+(attempt?'-retry-'+attempt:''),file=out+'/llm-cache/'+key+'.json';let saved;
 if(fs.existsSync(file))saved=read(file);else{const response=await nativeFetch(url,options);saved={status:response.status,body:await response.text(),at:new NativeDate().toISOString()};fs.writeFileSync(file,JSON.stringify(saved));}let usage=null;try{usage=JSON.parse(saved.body).usage??null;}catch{}requestLog.push({at:clock,host,key,status:saved.status,usage});return new Response(saved.body,{status:saved.status,headers:{'content-type':'application/json'}});};
async function main(){
 const scanner=require(dist+'/schedulers/market-scan.scheduler'),retest=require(dist+'/services/transition-breakout-retest.service'),dispatch=new(require(dist+'/services/groq-dispatch.service').GroqDispatchService)(),method=require(dist+'/config/methods').getMethodConfig('kim_nghia');const captureOnly=process.argv.includes('--capture-only');
 for(let t=protocol.start;t+60000<protocol.end;t+=300000){
  clock=t+5000;await scanner.runManualMarketScan();clock=t+60000;
  const ready=retest.getTransitionRetestStateForTests().opportunities.filter(p=>p.candidate_kind==='range_sweep_reclaim'&&p.side==='long'&&Date.parse(p.expires_at)>clock).sort((a,b)=>Date.parse(a.confirmed_at)-Date.parse(b.confirmed_at));
  if(ready.length){const p=await retest.claimTransitionRetestOpportunity(ready[0].candidate_key);if(p){const scan=scanner.getScanResult('BTC',p.timeframe),signal={...p.signal_result,pass:true,shouldCallGroq:true,isDuplicate:false,reason:`Stateful ${p.candidate_kind} retest confirmed (${p.candidate_key})`};
   const input={symbol:'BTC',timeframe:p.timeframe,candles:scan.candles,systemPrompt:method.systemPrompt,method_id:'kim_nghia',signalResult:signal,retestContext:{candidateKey:p.candidate_key,candidateKind:p.candidate_kind,side:p.side,boundaryPrice:p.boundary_price,breakoutBarKey:p.breakout_bar_key,confirmedEntryPrice:p.entry_price,minRr:p.rr,rangeLow:Number(p.adaptive_evidence?.range_low),rangeHigh:Number(p.adaptive_evidence?.range_high)}};
   opportunities.push({time:clock,opportunity:p,input});
   if(!captureOnly){const r=await dispatch.dispatch(input);reviews.push({time:clock,id:p.candidate_key,decision:r.decision,reason:r.reason,analysis:r.analysis});log(JSON.stringify({review:reviews.length,time:new NativeDate(clock).toISOString(),decision:r.decision,reason:r.reason}));}
  }}
  if((t-protocol.start)%86400000===0)log(JSON.stringify({day:(t-protocol.start)/86400000,opportunities:opportunities.length,errors:failures.length}));
 }
 if(maxFutureRead>0)throw Error('future candle read');for(const [name,value]of Object.entries({opportunities,reviews,events,requests:requestLog,checks:{candleReads:reads,maxFutureRead,counts,failures,adapters:Object.keys(adapters),captureOnly}}))fs.writeFileSync(out+'/'+name+'.json',JSON.stringify(value));log('COMPLETE '+JSON.stringify({opportunities:opportunities.length,reviews:reviews.length,requests:requestLog.length,failures:failures.length}));
}
main().catch(e=>{log(e.stack);process.exitCode=1});

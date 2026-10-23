/* Deployed modules, historical clock, in-memory persistence; trading adapters cannot load. */
require('dotenv').config({quiet:true});const fs=require('fs'),path=require('path'),crypto=require('crypto'),Module=require('module');
const base=path.resolve(__dirname,'../../docs/audits/2026-09-24-live-testbed'),out=path.resolve(__dirname,'../../docs/audits/2026-09-25-entry-experiments'),dist=base+'/dist',read=p=>JSON.parse(fs.readFileSync(p)),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const protocol=read(base+'/protocol.json'),data=read(base+'/market.json');if(sha(fs.readFileSync(base+'/market.json'))!==read(base+'/market-manifest.json').sha256)throw Error('market changed');
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
global.fetch=async(url,options={})=>{if(options.body){const body=JSON.parse(options.body);body.max_completion_tokens=1024;options={...options,body:JSON.stringify(body)};}const host=new URL(String(url)).hostname;if(!['api.groq.com','openrouter.ai','api.cerebras.ai'].includes(host))throw Error('Forbidden network host '+host);const baseKey=sha(String(url)+'\n'+String(options.body||'')),attempt=seenRequests.get(baseKey)||0;seenRequests.set(baseKey,attempt+1);const key=baseKey+(attempt?'-retry-'+attempt:''),file=out+'/llm-cache/'+key+'.json';let saved;
 if(fs.existsSync(file))saved=read(file);if(!saved||saved.status===429){for(let retry=0;retry<4;retry++){const response=await nativeFetch(url,options);saved={status:response.status,body:await response.text(),at:new NativeDate().toISOString()};fs.writeFileSync(file,JSON.stringify(saved));if(saved.status!==429)break;const seconds=Number(saved.body.match(/try again in ([0-9.]+)s/i)?.[1]||45);log(JSON.stringify({rateLimit:true,retry,waitSeconds:Math.min(55,Math.ceil(seconds)+2)}));await new Promise(r=>setTimeout(r,Math.min(55,Math.ceil(seconds)+2)*1000));}}let usage=null;try{usage=JSON.parse(saved.body).usage??null;}catch{}requestLog.push({at:clock,host,key,status:saved.status,usage});return new Response(saved.body,{status:saved.status,headers:{'content-type':'application/json'}});};

async function main(){
 const client=require(dist+'/services/groq-client').createGroqClient();if(!client)throw Error('No AI client');
 const entries=read(out+'/entries.json');
 const systemPrompt='You are a BTC futures research entry veto. Evaluate ONLY the proposed immutable plan using supplied closed candles. No future information or historical outcomes are supplied. Reject weak confirmation, chasing, bad target room, or poor edge after 0.10% roundtrip fees and 0.20% roundtrip slippage. Do not redesign levels. Return a JSON object with bias, action (buy/sell/hold), confidence (0-100), reason_summary. Confidence is a rating, not a calibrated win probability. Return hold if uncertain.';
 fs.writeFileSync(out+'/ai-protocol.json',JSON.stringify({systemPrompt,temperature:.2,threshold:80,maxCompletionTokens:1024,role:'Experimental veto on each new plan, using deployed provider client; NOT unchanged live dispatch prompt/gates.',coldMemory:true},null,2));
 const compact=(tf,n)=>candles(tf,n).map(b=>[b.timestamp,b.open,b.high,b.low,b.close,Math.round(b.volume)]);const rows=[];
 for(const e of entries){
  clock=e.candidate.time;const userPrompt=JSON.stringify({symbol:'BTC',asOf:new NativeDate(clock).toISOString(),plan:e.candidate,confirmation:e.confirmation,range:{low:e.seed.adaptive_evidence.range_low,high:e.seed.adaptive_evidence.range_high},candleColumns:['timestamp','open','high','low','close','volume'],candles5m:compact('5m',24),candles1h:compact('1h',24),candles4h:compact('4h',12)});
  let analysis=null,error=null;try{analysis=await client.analyze({systemPrompt,userPrompt,temperature:.2,maxRetries:0});}catch(err){error=String(err.message);}
  const expected=e.candidate.side==='long'?'buy':'sell';
  const approved=analysis?.action===expected&&Number.isFinite(analysis.confidence)&&analysis.confidence>=80&&analysis.confidence<=100;
  rows.push({id:e.candidate.id,time:clock,approved,analysis,error});
  fs.writeFileSync(out+'/reviews.json',JSON.stringify(rows,null,2));
  log(JSON.stringify({done:rows.length,total:entries.length,variant:e.variant,approved,error}));
 }
 if(maxFutureRead>0)throw Error('future candles');
 fs.writeFileSync(out+'/requests.json',JSON.stringify(requestLog,null,2));fs.writeFileSync(out+'/ai-checks.json',JSON.stringify({reads,maxFutureRead,failures},null,2));
}
main().catch(e=>{log(e.stack);process.exitCode=1});

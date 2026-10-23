// Read-only baseline archive; deliberately excludes secret environment variables and .env files.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const out=path.resolve(process.argv[2]||'');if(!process.argv[2]||fs.existsSync(out))throw Error('Usage: NEW_DIRECTORY');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const inventory=root=>Object.fromEntries(fs.readdirSync(root,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>{const p=path.join(e.parentPath||e.path,e.name);return[path.relative(root,p),sha(fs.readFileSync(p))];}).sort(([a],[b])=>a.localeCompare(b)));
const apps=JSON.parse(cp.execFileSync('pm2',['jlist'],{encoding:'utf8'}));
const names=['crypto-api','crypto-worker','crypto-post-exit'],selected=names.map(name=>apps.find(a=>a.name===name));
if(selected.some(a=>!a?.pid||a.pm2_env.status!=='online'))throw Error('runtime_not_online');
const worker=selected[1],build=path.dirname(worker.pm2_env.pm_exec_path);
const publicKeys=['MAX_EFFECTIVE_RISK_PER_TRADE_USD','MAX_EFFECTIVE_RISK_PER_TRADE_PERCENT','DAILY_LOSS_LIMIT_PERCENT',
 'MIN_SL_DISTANCE_PERCENT','RISK_PER_TRADE_PERCENT','MAX_TOTAL_EXPOSURE_USD','POST_CLOSE_SAME_SIDE_COOLDOWN_MINUTES',
 'POST_LOSS_SAME_SIDE_COOLDOWN_MINUTES','PENDING_ORDER_REENTRY_COOLDOWN_MINUTES','CONSECUTIVE_LOSS_COOLDOWN_HOURS',
 'LOSS_COOLDOWN_TIER2_HOURS','LOSS_COOLDOWN_TIER3_HOURS','LOSS_COOLDOWN_TIER3_UNTIL_UTC_DAY','CIRCUIT_EXPECTANCY_COOLDOWN_HOURS',
 'LLM_PROVIDER','OPENROUTER_DISPATCH_MODEL','OPENROUTER_SHADOW_MODEL','OPENROUTER_LEVELS_ADAPTER_MODEL',
 'GROQ_MODEL_PRIMARY','GROQ_MODEL','GROQ_MODEL_FALLBACKS','LEVELS_ADAPTER_PROVIDER','BINANCE_USER_STREAM_ON_WORKER'];
const envBytes=selected.map(a=>fs.readFileSync('/proc/'+a.pid+'/environ','utf8'));
const envs=envBytes.map(bytes=>Object.fromEntries(bytes.split('\0').filter(Boolean).map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)];})));
Object.assign(process.env,envs[1]);
const risk=require(path.join(build,'config/risk-policy')).getRiskPolicy();
const models=require(path.join(build,'config/openrouter-models'));
const groq=require(path.join(build,'config/groq-models'));
const before=inventory(build);fs.mkdirSync(out,{recursive:true});fs.cpSync(build,path.join(out,'runtime'),{recursive:true});
if(JSON.stringify(inventory(build))!==JSON.stringify(before)||JSON.stringify(inventory(path.join(out,'runtime')))!==JSON.stringify(before))throw Error('baseline_changed');
for(let i=0;i<selected.length;i++)if(fs.readFileSync('/proc/'+selected[i].pid+'/environ','utf8')!==envBytes[i])throw Error('environment_changed');
const manifest={schema:'bounded-baseline-v1',frozenAt:new Date().toISOString(),runtimeHashes:before,
 apps:selected.map((a,i)=>({name:a.name,pid:a.pid,status:a.pm2_env.status,entrypoint:a.pm2_env.pm_exec_path,
  publicEnvironment:Object.fromEntries(publicKeys.map(k=>[k,envs[i][k]??null]))})),
 resolvedRiskPolicy:risk,resolvedModels:{provider:models.getLlmProvider(),dispatch:models.getOpenRouterDispatchModel(),
  shadow:models.getOpenRouterShadowModel(),levels:models.getOpenRouterLevelsAdapterModel(),groqPrimary:groq.getGroqPrimaryModel()},
 promptCoverage:'Compiled prompts captured in complete runtime archive; per-decision prompt/memory inputs still require recorded journal.',
 initialState:'Captured separately with its own timestamp; not a historical initial state for older windows.',
 candleCutoff:'Unknown until the specific replay dataset/window is selected; frozenAt is not a market candle cutoff.',
 historicalParity:'unproved',secretsIncluded:false,liveCodeOrEnvironmentChanged:false};
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({out,frozenAt:manifest.frozenAt,files:Object.keys(before).length,models:manifest.resolvedModels,historicalParity:manifest.historicalParity}));

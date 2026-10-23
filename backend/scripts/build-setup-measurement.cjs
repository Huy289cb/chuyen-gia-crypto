// Overlay telemetry onto explicit runtime tree; preserve unrelated deployed behavior.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
const [baseline,out]=process.argv.slice(2);if(!out||fs.existsSync(out))throw Error('Usage: BASELINE NEW_PACKAGE');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function inventory(root){return Object.fromEntries(fs.readdirSync(root,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>{const p=path.join(e.parentPath||e.path,e.name);return [path.relative(root,p),sha(fs.readFileSync(p))];}).sort(([a],[b])=>a.localeCompare(b)));}
const before=inventory(baseline);fs.mkdirSync(out,{recursive:true});for(const name of ['baseline','release'])fs.cpSync(baseline,path.join(out,name),{recursive:true});
function patch(file,anchor,value){const p=path.join(out,'release',file),s=fs.readFileSync(p,'utf8');if(s.split(anchor).length!==2)throw Error('ambiguous_anchor:'+file+':'+anchor);fs.writeFileSync(p,s.replace(anchor,value));}
for(const name of ['breakout-volume','liquidity-sweep']){
 const sweep=name==='liquidity-sweep';
 const body=sweep?`detectorVersion: 'liquidity_sweep_v1',
 anchorHighOpenTime: recentCandles.slice(0,-1).find(c=>c.high===highestHigh)?.timestamp ?? null,
 anchorLowOpenTime: recentCandles.slice(0,-1).find(c=>c.low===lowestLow)?.timestamp ?? null,
 anchorWindowEndOpenTime: recentCandles.at(-2)?.timestamp ?? null,
 detectionOpenTime: currentCandle.timestamp,`:`detectorVersion: 'breakout_volume_v1',
 anchorHighOpenTime: consolidationCandles.find(c=>c.high===resistance)?.timestamp ?? null,
 anchorLowOpenTime: consolidationCandles.find(c=>c.low===support)?.timestamp ?? null,
 anchorWindowEndOpenTime: consolidationCandles.at(-1)?.timestamp ?? null,
 detectionOpenTime: currentCandle.timestamp,`;
 patch(`analyzers/${name}.analyzer.js`,'const metrics = {','const metrics = {\n'+body);
}
patch('utils/closed-candles.js','const TIMEFRAME_MS = {','exports.timeframeDurationMs = timeframe => TIMEFRAME_MS[timeframe.toLowerCase()] ?? null;\nconst TIMEFRAME_MS = {');
const source=fs.readFileSync(path.join(__dirname,'../src/utils/setup-identity.ts'),'utf8');
fs.writeFileSync(path.join(out,'release/utils/setup-identity.js'),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText);
patch('services/entry-gate-funnel.service.js','measurement_version: 2,',`measurement_version: 2,
 setup_identity: require('../utils/setup-identity').identifyAnchoredSetup({symbol:input.symbol,timeframe:input.timeframe,
 playbook:setup.playbookKey??'unknown',side,
 detected:setup.evidence.playbooks.find(p=>p.playbook===setup.playbookKey)?.detected??false,
 metrics:setup.evidence.playbooks.find(p=>p.playbook===setup.playbookKey)?.metrics??{},
 asOf,graceMs:closed_candles_1.getClosedCandleFinalizationGraceMs()}),`);
patch('services/groq-dispatch.service.js','if (signalResult.isDuplicate) {',`const measuredSetup=signalResult.setupResult;
 const measuredEvidence=measuredSetup.evidence.playbooks.find(p=>p.playbook===measuredSetup.playbookKey);
 const measuredIdentity=require('../utils/setup-identity').identifyAnchoredSetup({symbol,timeframe,
 playbook:measuredSetup.playbookKey??'unknown',
 side:require('../utils/setup-trade-side').inferSetupTradeSide(measuredSetup,timeframe,candles),
 detected:measuredEvidence?.detected??false,metrics:measuredEvidence?.metrics??{},
 asOf:Date.now(),graceMs:require('../utils/closed-candles').getClosedCandleFinalizationGraceMs()});
 const activeTrace=entry_trace_1.currentEntryTrace();if(activeTrace)activeTrace.setup_identity=measuredIdentity;
 await entry_trace_1.recordEntryStage('setup_identified',{setup_identity:measuredIdentity});
 if (signalResult.isDuplicate) {`);
patch('services/account-risk-guard.service.js','if (protectiveBlock) {',`await require('../utils/entry-trace').recordEntryStage('account_guard_inputs',{
 account_schema:'account-guard-inputs-v1',account_id:accountId,observed_at:now.toISOString(),
 balance:account.current_balance??null,equity:account.equity??null,cooldown_until:account.cooldown_until?.toISOString()??null,
 consecutive_losses:account.consecutive_losses??null,protective_block:protectiveBlock??null,policy,
 exchange_loss_streak_status:'not_evaluated',circuit_status:'not_evaluated'});
 if (protectiveBlock) {`);
patch('services/account-risk-guard.service.js','if (!circuit.allowed) {',`await require('../utils/entry-trace').recordEntryStage('account_circuit_evaluated',{
 account_schema:'account-circuit-status-v1',account_id:accountId,observed_at:new Date().toISOString(),circuit});
 if (!circuit.allowed) {`);
const after=inventory(path.join(out,'release'));if(JSON.stringify(before)!==JSON.stringify(inventory(baseline)))throw Error('baseline_changed');
const changedFiles=Object.keys(after).filter(k=>before[k]!==after[k]);
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({schema:'setup-measurement-package-v1',baseline:before,release:after,changedFiles,runtimeDeployed:false,environmentChanges:false,identitySourceSha256:sha(source)},null,2));
console.log(JSON.stringify({out,changedFiles}));

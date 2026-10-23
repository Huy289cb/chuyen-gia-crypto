// Retrospective regime annotation using production classifier and past closed candles only.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [inventory,candlesFile,out]=process.argv.slice(2);if(!out)throw Error('Usage: INVENTORY CANDLES NEW_REPORT');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const file=path.resolve(__dirname,'../dist/utils/structure-bias.js'),{classifyStructureBias}=require(file);
const raw=fs.readFileSync(inventory),candleBytes=fs.readFileSync(candlesFile),candles=JSON.parse(candleBytes);
const rows=JSON.parse(raw).map(r=>{
 const d=r.event_data,asOf=Date.parse(d.evaluated_at||r.timestamp);
 const closed=candles.filter(c=>c.timestamp+14400000+5000<=asOf).slice(-120);
 const computed=closed.length===120?classifyStructureBias(closed,{strength:2}):null;
 const recorded=d.structure_detail?.bias??d.structure_bias??null;
 return {eventId:r.id,asOf,observationKey:d.observation_key,timeframe:d.timeframe,side:d.side,playbook:d.playbook,
  reference:d.breakout_metrics?.lastClose??null,recorded,reconstructed:computed?.bias??null,
  matchesRecorded:recorded&&computed?recorded===computed.bias:null};
});
const known=rows.filter(r=>r.matchesRecorded!==null);
const result={schema:'reconstructed-regime-v1',sourceHashes:{inventory:sha(raw),candles:sha(candleBytes),classifier:sha(fs.readFileSync(file))},
 assumptions:{timeframe:'4h',strength:2,limit:120,graceMs:5000},coverage:{rows:rows.length,recorded:known.length,matches:known.filter(r=>r.matchesRecorded).length,mismatches:known.filter(r=>!r.matchesRecorded).length},rows,
 limits:['Retrospective annotation, not a historical snapshot of configuration.','Matches are component validation only, not proof of causal alpha.','No signal controls may be used only with explicit reconstruction provenance.']};
fs.writeFileSync(out,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result.coverage));

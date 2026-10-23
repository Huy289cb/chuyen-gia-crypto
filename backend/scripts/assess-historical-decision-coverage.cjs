'use strict';
const fs=require('fs'),path=require('path');
function assess(result){
 const rows=result.trade_decisions??result.decisions??[];
 const reasons={};const counts={};const keys=new Set();let missingKeys=0;
 for(const row of rows){
  counts[row.decision]=(counts[row.decision]??0)+1;
  const reason=String(row.reason??'');
  const group=/SL distance .*below min/i.test(reason)?'SL_below_floor':/invalid JSON|failed validation/i.test(reason)?'provider_validation':/risk.*cap|effective.*risk/i.test(reason)?'risk_cap':/exposure/i.test(reason)?'exposure':/circuit|drawdown/i.test(reason)?'circuit':/target.*room/i.test(reason)?'target_room':'other_unclassified';
  reasons[group]=(reasons[group]??0)+1;
  if([row.symbol,row.timeframe,row.candle_hash,row.method_id].every(x=>typeof x==='string'&&x.length))keys.add(JSON.stringify([row.symbol,row.timeframe,row.candle_hash,row.method_id]));else missingKeys++;
 }
 return {schema:'historical-decision-coverage-v1',scope:'Recorded decisions only; no inference about opportunities omitted before decision persistence',decision_rows:rows.length,decision_counts:counts,reason_text_groups:reasons,reason_group_basis:'descriptive text classification; not structured causal attribution',unique_recorded_bar_method_keys:keys.size,rows_without_bar_method_key:missingKeys,independent_setup_count:null,pre_filter_opportunity_count:null,limitations:['Bar/method identity is not independent setup/wave identity','Scheduler steps do not enumerate every pre-filter opportunity','Reason text may report first veto only; unclassified rows retained','Interim snapshot may omit identity columns; missing is not evidence of absent production lineage']};
}
module.exports={assess};
if(require.main===module){const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('INPUT_JSON NEW_REPORT_JSON');const report=assess(JSON.parse(fs.readFileSync(input)));fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));}

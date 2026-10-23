'use strict';
const {randomUUID}=require('node:crypto');
function createPortfolioCommandJournal({database,positionId}){
 if(!database||!positionId)throw Error('explicit_command_journal_storage_required');
 const scope={position_id:positionId};
 const parse=row=>JSON.parse(row.event_data);
 async function unmatched(tx){const rows=await tx.testnetTradeEvent.findMany({where:{...scope,event_type:{in:['portfolio_command_started','portfolio_command_completed']}}});const complete=new Set(rows.filter(x=>x.event_type==='portfolio_command_completed').map(x=>parse(x).command_key));return rows.filter(x=>x.event_type==='portfolio_command_started'&&!complete.has(parse(x).command_key)).map(parse);}
 return {
  async begin(data){return database.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${positionId}))`;const gaps=await unmatched(tx);if(gaps.length)throw Error('durable_portfolio_command_gap');const command_key=randomUUID();await tx.testnetTradeEvent.create({data:{...scope,event_type:'portfolio_command_started',event_data:JSON.stringify({...data,command_key}),timestamp:new Date(data.at)}});return command_key;},{timeout:60000,maxWait:10000});},
  async complete(checkpoint){return database.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${positionId}))`;const gaps=await unmatched(tx);if(gaps.length!==1||gaps[0].command_key!==checkpoint.command_key)throw Error('command_completion_without_unique_start');const reads=checkpoint.operations.filter(o=>/^(find|count|aggregate)/.test(o.method));const decisionIds=[...new Set([gaps[0].input_decision_id,...checkpoint.operations.filter(o=>o.model==='tradeDecision'&&o.method==='create').map(o=>o.result?.id)].filter(x=>Number.isInteger(x)))];const value={...checkpoint,decision_references:decisionIds.map(decision_id=>({decision_id,command_key:checkpoint.command_key,read_operation_sequences:reads.map(r=>r.sequence),basis:'command-context actual ORM reads; not proof each decision consumed every read'}))};const saved=await tx.testnetTradeEvent.create({data:{...scope,event_type:'portfolio_command_checkpoint',event_data:JSON.stringify(value),timestamp:new Date(checkpoint.at)}});await tx.testnetTradeEvent.create({data:{...scope,event_type:'portfolio_command_completed',event_data:JSON.stringify({command_key:checkpoint.command_key,checkpoint_event_id:saved.id}),timestamp:new Date(checkpoint.at)}});return saved.id;},{timeout:60000,maxWait:10000});},
  async recoverCausalInventory(asOf){
   if(!Number.isFinite(asOf))throw Error('explicit_recovery_clock_required');
   return database.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${positionId}))`;
    if((await unmatched(tx)).length)throw Error('durable_portfolio_command_gap');
    const rows=await tx.testnetTradeEvent.findMany({where:{...scope,event_type:{in:['portfolio_command_checkpoint','portfolio_command_started']}},orderBy:{id:'asc'}});
    let state=null;const plans=new Map(),attempted=new Set();
    for(const row of rows){const data=parse(row);
     if(!Number.isFinite(data.at)||data.at>asOf)throw Error('future_causal_recovery_event');
     if(row.event_type==='portfolio_command_started'&&data.kind==='causal_review'){
      if(typeof data.causal_setup_id!=='string'||!data.causal_setup_id)throw Error('missing_causal_attempt_identity');
      attempted.add(data.causal_setup_id);
     }
     if(row.event_type==='portfolio_command_checkpoint'&&data.kind==='causal_inventory'){
      const value=data.causal_inventory;
      if(value?.state?.version!=='h1-h2-inventory-v1'||value.state.lastAt!==data.at||!Array.isArray(value.events))throw Error('invalid_causal_checkpoint');
      state=value.state;
      for(const event of value.events)if(event.kind==='resolved'&&event.outcome?.status==='plan'){
       const id=event.row?.candidate?.id;if(typeof id!=='string'||!id)throw Error('missing_causal_plan_identity');
       if(plans.has(id))throw Error('duplicate_causal_plan_delivery');
       plans.set(id,event);
      }
     }
    }
    return {state,undeliveredPlans:[...plans].filter(([id])=>!attempted.has(id)).map(([,event])=>event),attemptedSetupIds:[...attempted]};
   },{timeout:60000,maxWait:10000});
  },
  async gaps(){return unmatched(database);}
 };
}
module.exports={createPortfolioCommandJournal};

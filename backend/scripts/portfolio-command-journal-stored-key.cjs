'use strict';
const {randomUUID}=require('node:crypto');
function createPortfolioCommandJournal({database,positionId,storageSchema}){
 if(typeof storageSchema!=='string'||!/^engine_[a-z0-9_]+$/.test(storageSchema))throw Error('explicit_isolated_storage_schema_required');
 const eventTable='"'+storageSchema+'".testnet_trade_events';
 if(!database||!positionId)throw Error('explicit_command_journal_storage_required');
 let prepared=false;
 const requirePrepared=()=>{if(!prepared)throw Error('journal_prepare_required');};
 const scope={position_id:positionId};
 const parse=row=>JSON.parse(row.event_data);
 async function unmatched(tx){
  requirePrepared();
  // Filtering stays on PostgreSQL; only unmatched starts cross the client boundary.
  const rows=await tx.$queryRawUnsafe(`SELECT s.event_data FROM ${eventTable} s
   WHERE s.position_id=$1 AND s.event_type='portfolio_command_started'
   AND NOT EXISTS (SELECT 1 FROM ${eventTable} c WHERE c.position_id=s.position_id
    AND c.event_type='portfolio_command_completed'
    AND c.portfolio_command_key=s.portfolio_command_key)`,positionId);
  return rows.map(parse);
 }

 return {
  async prepare(){
   await database.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${storageSchema+':journal-gap-schema'}))`;
    // Validate existing history once and reject future corrupt keys at storage boundary.
    const existing=await tx.$queryRawUnsafe('SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=$1 AND t.relname=$2 AND c.conname=$3',storageSchema,'testnet_trade_events','portfolio_command_key_valid');
    if(!existing.length)await tx.$executeRawUnsafe(`ALTER TABLE ${eventTable} ADD CONSTRAINT portfolio_command_key_valid CHECK (event_type NOT IN ('portfolio_command_started','portfolio_command_completed') OR COALESCE(jsonb_typeof(event_data::jsonb->'command_key')='string' AND length(event_data::jsonb->>'command_key')>0,false))`);
    await tx.$executeRawUnsafe(`ALTER TABLE ${eventTable} ADD COLUMN IF NOT EXISTS portfolio_command_key text GENERATED ALWAYS AS (CASE WHEN event_type IN ('portfolio_command_started','portfolio_command_completed') THEN event_data::jsonb->>'command_key' ELSE NULL END) STORED`);
    await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS portfolio_command_stored_key_idx ON ${eventTable} (position_id,event_type,portfolio_command_key) WHERE event_type IN ('portfolio_command_started','portfolio_command_completed')`);
   },{timeout:60000,maxWait:10000});
   prepared=true;
  },
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

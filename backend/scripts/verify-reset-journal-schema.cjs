const assert=require('node:assert/strict');
async function verifyResetJournalSchema(db){
 const columns=await db.$queryRawUnsafe("SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='account_mutation_journal' ORDER BY ordinal_position");
 assert.deepEqual(columns,[['attempt_id','uuid',null],['account_id','integer',null],['mutation_kind','text',null],['evidence','jsonb',null],['recorded_at','timestamp with time zone','clock_timestamp()']].map(([column_name,data_type,column_default])=>({column_name,data_type,is_nullable:'NO',column_default})),'journal columns mismatch');
 const constraints=await db.$queryRawUnsafe("SELECT contype,convalidated,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.account_mutation_journal'::regclass ORDER BY pg_get_constraintdef(oid)");
 assert.deepEqual(constraints,[['c','CHECK ((account_id > 0))'],['c',"CHECK ((jsonb_typeof(evidence) = 'object'::text))"],['c',"CHECK ((mutation_kind = 'admin_local_reset'::text))"],['p','PRIMARY KEY (attempt_id)']].map(([contype,definition])=>({contype,definition,convalidated:true})),'journal constraints mismatch');
 const indexes=await db.$queryRawUnsafe("SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='account_mutation_journal' ORDER BY indexname");
 assert.deepEqual(indexes,[{indexdef:'CREATE INDEX account_mutation_journal_account_time ON public.account_mutation_journal USING btree (account_id, recorded_at)'},{indexdef:'CREATE UNIQUE INDEX account_mutation_journal_pkey ON public.account_mutation_journal USING btree (attempt_id)'}],'journal indexes mismatch');
 const triggers=await db.$queryRawUnsafe("SELECT tgname FROM pg_trigger WHERE tgrelid='public.account_mutation_journal'::regclass AND NOT tgisinternal");assert.equal(triggers.length,0,'unexpected journal triggers');
 return {compatible:true,columns:columns.length,constraints:constraints.length,indexes:indexes.length};
}
module.exports={verifyResetJournalSchema};

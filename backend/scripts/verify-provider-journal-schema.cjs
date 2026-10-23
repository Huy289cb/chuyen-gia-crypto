const assert=require('node:assert/strict');
async function verifyProviderJournalSchema(db){
 const columns=await db.$queryRawUnsafe("SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='provider_request_journal' ORDER BY ordinal_position");
 assert.deepEqual(columns,[['request_id','text',null],['event_type','text',null],['metadata','jsonb',null],['recorded_at','timestamp with time zone','clock_timestamp()']].map(([column_name,data_type,column_default])=>({column_name,data_type,is_nullable:'NO',column_default})),'provider journal columns mismatch');
 const constraints=await db.$queryRawUnsafe("SELECT contype,convalidated,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.provider_request_journal'::regclass ORDER BY pg_get_constraintdef(oid)");
 assert.deepEqual(constraints,[['c','CHECK (((length(btrim(request_id)) > 0) AND (length(request_id) <= 512)))'],['c',"CHECK ((event_type = ANY (ARRAY['llm_provider_request'::text, 'llm_provider_result'::text])))"],['c',"CHECK ((jsonb_typeof(metadata) = 'object'::text))"],['p','PRIMARY KEY (request_id, event_type)']].map(([contype,definition])=>({contype,definition,convalidated:true})),'provider journal constraints mismatch');
 const indexes=await db.$queryRawUnsafe("SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='provider_request_journal' ORDER BY indexname");
 assert.deepEqual(indexes,[{indexdef:'CREATE UNIQUE INDEX provider_request_journal_pkey ON public.provider_request_journal USING btree (request_id, event_type)'},{indexdef:'CREATE INDEX provider_request_journal_recorded_at_idx ON public.provider_request_journal USING btree (recorded_at, request_id, event_type)'}],'provider journal indexes mismatch');
 const triggers=await db.$queryRawUnsafe("SELECT tgname FROM pg_trigger WHERE tgrelid='public.provider_request_journal'::regclass AND NOT tgisinternal");assert.equal(triggers.length,0,'unexpected provider journal triggers');
 const relation=await db.$queryRawUnsafe("SELECT relkind,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public.provider_request_journal'::regclass");assert.deepEqual(relation,[{relkind:'r',relrowsecurity:false,relforcerowsecurity:false}],'provider journal relation mismatch');
 return {compatible:true,columns:columns.length,constraints:constraints.length,indexes:indexes.length};
}
module.exports={verifyProviderJournalSchema};

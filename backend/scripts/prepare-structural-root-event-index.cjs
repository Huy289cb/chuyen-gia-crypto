'use strict';
// Research-only physical access path; never alters journal semantics or uniqueness.
const INDEX_NAME='structural_root_event_lookup_idx';
const CATALOG_SQL=`SELECT jsonb_build_object('relation_kind',c.relkind,'method',am.amname,'unique',i.indisunique,'primary',i.indisprimary,'valid',i.indisvalid,'ready',i.indisready,'table_schema',tn.nspname,'table_name',t.relname,'no_predicate',i.indpred IS NULL,'no_expressions',i.indexprs IS NULL,'key_count',i.indnkeyatts,'attribute_count',i.indnatts,'options',ARRAY(SELECT option FROM unnest(i.indoption) option),'default_operator_classes',NOT EXISTS(SELECT 1 FROM unnest(i.indclass) op JOIN pg_opclass oc ON oc.oid=op WHERE NOT oc.opcdefault),'default_collations',NOT EXISTS(SELECT 1 FROM unnest(i.indcollation) WITH ORDINALITY col(collation_oid,ord) JOIN unnest(i.indkey) WITH ORDINALITY k(attnum,ord) USING(ord) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum WHERE col.collation_oid<>a.attcollation),'columns',ARRAY(SELECT a.attname FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum ORDER BY k.ord),'definition',pg_get_indexdef(i.indexrelid)) AS definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_index i ON i.indexrelid=c.oid LEFT JOIN pg_class t ON t.oid=i.indrelid LEFT JOIN pg_namespace tn ON tn.oid=t.relnamespace LEFT JOIN pg_am am ON am.oid=c.relam WHERE n.nspname=$1 AND c.relname=$2`;
function validateDefinition(row,storageSchema){
 const d=row?.definition;
 if(!d||d.relation_kind!=='i'||d.method!=='btree'||d.unique!==false||d.primary!==false||d.valid!==true||d.ready!==true||d.table_schema!==storageSchema||d.table_name!=='testnet_trade_events'||d.no_predicate!==true||d.no_expressions!==true||d.key_count!==3||d.attribute_count!==3||JSON.stringify(d.options)!==JSON.stringify([0,0,0])||d.default_operator_classes!==true||d.default_collations!==true||JSON.stringify(d.columns)!==JSON.stringify(['position_id','event_type','id']))throw Error('structural_root_index_definition_mismatch');
 return d;
}
async function prepareStructuralRootEventIndex({database,storageSchema}){
 if(!/^engine_[a-zA-Z0-9_]+$/.test(storageSchema??''))throw Error('explicit_isolated_structural_root_schema_required');
 if(!database||typeof database.$queryRawUnsafe!=='function'||typeof database.$executeRawUnsafe!=='function')throw Error('explicit_storage_adapter_required');
 const before=await database.$queryRawUnsafe(CATALOG_SQL,storageSchema,INDEX_NAME);
 if(before.length>1)throw Error('structural_root_index_catalog_ambiguous');
 if(before.length)return{created:false,index_name:INDEX_NAME,storage_schema:storageSchema,definition:validateDefinition(before[0],storageSchema)};
 await database.$executeRawUnsafe(`CREATE INDEX "${INDEX_NAME}" ON "${storageSchema}"."testnet_trade_events" USING btree ("position_id", "event_type", "id")`);
 const after=await database.$queryRawUnsafe(CATALOG_SQL,storageSchema,INDEX_NAME);
 if(after.length!==1)throw Error('structural_root_index_missing_after_create');
 return{created:true,index_name:INDEX_NAME,storage_schema:storageSchema,definition:validateDefinition(after[0],storageSchema)};
}
module.exports={prepareStructuralRootEventIndex,INDEX_NAME};

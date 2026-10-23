'use strict';
function createSqlSnapshot({database,storageSchema}){
 if(!/^engine_[a-zA-Z0-9_]+$/.test(storageSchema??''))throw Error('explicit_isolated_snapshot_schema_required');
 const specs=[['accounts','TestnetAccount','testnet_accounts'],['positions','TestnetPosition','testnet_positions'],['pending','TestnetPendingOrder','testnet_pending_orders']];
 const fields=Object.fromEntries(specs.map(([key,model])=>{const m=database._runtimeDataModel?.models?.[model];if(!m)throw Error('snapshot_model_metadata_missing:'+model);for(const f of m.fields.filter(f=>f.kind==='scalar'))if(!['Int','Float','String','Boolean','DateTime','Json'].includes(f.type))throw Error('unsupported_snapshot_scalar:'+f.type);return[key,m.fields.filter(f=>f.kind==='scalar')];}));
 const sql='SELECT '+specs.map(([key,,table])=>`COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM "${storageSchema}"."${table}" t),'[]'::jsonb) AS "${key}"`).join(',');
 return async at=>{const rows=await database.$queryRawUnsafe(sql);if(rows.length!==1)throw Error('snapshot_row_count_invalid');const result={at};for(const [key]of specs){const values=rows[0][key];if(!Array.isArray(values))throw Error('snapshot_array_missing:'+key);result[key]=values.map(row=>{for(const f of fields[key]){if(!Object.hasOwn(row,f.name))throw Error('snapshot_field_missing:'+key+':'+f.name);if(row[f.name]===null){if(f.isRequired)throw Error('required_snapshot_field_null');continue;}if(f.type==='DateTime'){const raw=row[f.name];row[f.name]=new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(raw)?raw:raw+'Z');if(!Number.isFinite(row[f.name].getTime()))throw Error('snapshot_datetime_invalid');}}return row;});}return result;};
}
module.exports={createSqlSnapshot};

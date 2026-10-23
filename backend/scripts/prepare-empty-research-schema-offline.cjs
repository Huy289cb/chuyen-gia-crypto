'use strict';
// Source derived from one verified atomic application; calls are explicit and finite.
// Importing this module performs no DB/provider/CLI call.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const root = path.resolve(__dirname, '../..');
const sqlFile = path.join(root, 'docs/audits/2026-10-09-prisma-offline-bootstrap/prisma-from-empty.sql');
const referenceFile = path.join(root, 'docs/audits/2026-10-09-unused-schema-recovery/schema-readonly-stdout.json');
const expectedSources = Object.freeze({
  "backend/scripts/apply-prisma-offline-research-schema.cjs": "9ce143ed8b5273cdfc86896dcb002db518a71fcf2c2165af61399998a03dcfb1",
  "backend/prisma/schema.prisma": "cbff9d78d3bf4f3a8e14692513e64f33f9f319351f1b6701c7ab45b744f09d42",
  "backend/node_modules/prisma/package.json": "01c1aa746e5b0aebf01b38ec1aaffaebc098bacfe93b2f413fd4112de9251ae3",
  "backend/node_modules/prisma/build/index.js": "ff0102cdfadfecb884c5f0b6e43661f4ef2a31917dbfad3157236ba8e8532388",
  "docs/audits/2026-10-09-prisma-offline-bootstrap/prisma-from-empty.sql": "a47df2b29b29fb2a6d88d9f70c70acf187c7914517de4b5d35100aa37d645da8",
  "docs/audits/2026-10-09-unused-schema-recovery/schema-readonly-stdout.json": "252de10c486c9d658bf27a468654e942daa88d34b5efb0fe7d0bbd432e43c12a"
});
const expected = Object.freeze({ tables: 24, columns: 325, constraints: 36, indexes: 71, owned_serial_sequences: 23, all_new_business_counts_zero: true, reference_schema: 'engine_indexed_causal_workflow_20261009' });
const usedSchemas = new Set();
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function normalizeMetadata(rows, sourceSchema) {
  const token = new RegExp(sourceSchema, 'g');
  return rows.map(row => ({ table_name: row.table_name,
    definition: JSON.parse(JSON.stringify(row.definition).replace(token, 'engine_REFERENCE')),
  })).sort((a, b) => a.table_name.localeCompare(b.table_name));
}

function validateGeneratedSql(sql, tables) {
  // Current frozen datamodel has no enums, dollar bodies or semicolons in defaults.
  assert(!sql.includes('$$'), 'unsupported_generated_dollar_sql');
  const statements = sql.replace(/^\s*--[^\n]*$/gm, '').split(';').map(x => x.trim()).filter(Boolean);
  const created = [], indexes = [], foreignKeys = [];
  for (const statement of statements) {
    let match = statement.match(/^CREATE TABLE "([a-z_]+)"\s*\(/);
    if (match) {
      assert(tables.includes(match[1]), 'generated_table_outside_frozen_datamodel');
      assert(!/\b(?:REFERENCES|SELECT|DROP|INSERT|UPDATE|DELETE|EXECUTE|DO)\b/.test(statement), 'unsupported_create_table_sql');
      created.push(match[1]);
      continue;
    }
    match = statement.match(/^CREATE (?:UNIQUE )?INDEX "([a-z_]+)" ON "([a-z_]+)"\s*\(/);
    if (match) {
      assert(tables.includes(match[2]), 'generated_index_table_outside_frozen_datamodel');
      assert(!/\b(?:SELECT|DROP|INSERT|UPDATE|DELETE|EXECUTE|DO)\b/.test(statement), 'unsupported_create_index_sql');
      indexes.push(match[1]);
      continue;
    }
    match = statement.match(/^ALTER TABLE "([a-z_]+)" ADD CONSTRAINT "([a-z_]+)" FOREIGN KEY \("([a-z_]+)"\) REFERENCES "([a-z_]+)"\("([a-z_]+)"\) ON DELETE (?:CASCADE|RESTRICT|SET NULL) ON UPDATE CASCADE$/);
    if (match) {
      assert(tables.includes(match[1]) && tables.includes(match[4]), 'generated_foreign_key_outside_frozen_datamodel');
      foreignKeys.push(match[2]);
      continue;
    }
    throw Error('unsupported_generated_sql_statement');
  }
  assert.deepEqual([...created].sort(), [...tables].sort(), 'generated_table_set_mismatch');
  assert.equal(new Set(created).size, 24);
  assert.equal(indexes.length, 47, 'generated_explicit_index_count');
  assert.equal(foreignKeys.length, 12, 'generated_foreign_key_count');
  assert.equal((sql.match(/\bSERIAL\b/g) ?? []).length, 23, 'generated_serial_count');
  assert.equal((sql.match(/^\s+"[a-z_][a-z0-9_]*"\s+[A-Z]/gm) ?? []).length, 325, 'generated_column_count');
  assert(!/"public"\.|\bpublic\.|CREATE SCHEMA|DROP|TRUNCATE/.test(sql), 'generated_sql_outside_target_namespace');
  return { statements, created_tables: created, explicit_indexes: indexes, foreign_keys: foreignKeys };
}


async function prepareEmptyResearchSchemaOffline({ storageSchema, auditDirectory, deadlineUtc }) {
  const startedAt = Date.now(), schema = storageSchema, deadline = Date.parse(deadlineUtc);
  assert(/^engine_[a-zA-Z0-9_]{1,55}$/.test(schema ?? ''), 'strict_new_research_schema_required');
  assert(typeof deadlineUtc === 'string' && Number.isFinite(deadline), 'explicit_launcher_wall_deadline_required');
  const remaining = () => deadline - Date.now();
  assert(remaining() > 20000, 'bootstrap_wall_budget_insufficient');
  assert(!usedSchemas.has(schema), 'duplicate_fresh_schema_bootstrap_call');
  assert(typeof auditDirectory === 'string' && auditDirectory.length, 'new_bootstrap_audit_directory_required');
  const audit = path.resolve(auditDirectory), allowedAuditRoot = path.join(root, 'docs/audits') + path.sep;
  assert(audit.startsWith(allowedAuditRoot), 'research_bootstrap_audit_directory_required');
  assert(!fs.existsSync(audit), 'new_bootstrap_audit_directory_required');
  fs.mkdirSync(audit, { mode: 0o700 });
  usedSchemas.add(schema); // A failed explicit call is never retried in this process.
  const write = (name, value) => fs.writeFileSync(path.join(audit, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const result = { version: 'offline-fresh-research-schema-module-v1', target_schema: schema,
    started_at: new Date(startedAt).toISOString(), deadline_utc: deadlineUtc,
    status: 'starting', passed: false, committed: false, apply_transactions: 0,
    ddl_generations: 0, provider_calls: 0, production_touched: false, existing_schemas_mutated: false,
    index_installed: false, journal_installed: false, account_seeded: false,
    economic_goal_proven: false, promotion_allowed: false, phases: [], catalog_expected: expected };
  const phase = name => { assert(remaining() > 10000, 'bootstrap_registered_wall_exhausted'); result.phases.push({ name, at: new Date().toISOString(), elapsed_ms: Date.now() - startedAt }); };
  const registration = { catalog_expected: expected };
  let database, failure;
  try {
    for (const [file, hash] of Object.entries(expectedSources)) assert.equal(sha(path.join(root, file)), hash, 'offline_bootstrap_source_identity:' + file);
    assert.equal(require('../node_modules/prisma/package.json').version, '5.22.0');
    result.source_hashes = { ...expectedSources, [path.relative(root, __filename)]: sha(__filename) };
    write('source-manifest.json', result.source_hashes);
    const reference = JSON.parse(fs.readFileSync(referenceFile, 'utf8')).metadata.filter(row => row.schema === expected.reference_schema);
    const tables = reference.map(row => row.table_name).sort();
    assert.equal(tables.length, 24);
    const schemaText = fs.readFileSync(path.join(root, 'backend/prisma/schema.prisma'), 'utf8');
    assert.deepEqual([...schemaText.matchAll(/@@map\("([a-z_]+)"\)/g)].map(m => m[1]).sort(), tables);
    const sql = fs.readFileSync(sqlFile, 'utf8'), inspected = validateGeneratedSql(sql, tables);
    result.generated_sql_sha256 = sha(sqlFile);
    result.generated_sql_inspection = { statements: inspected.statements.length, tables: inspected.created_tables.length, explicit_indexes: inspected.explicit_indexes.length, foreign_keys: inspected.foreign_keys.length, serial_sequences: 23, columns: 325, qualified_other_namespaces: false };
    write('generated-sql-inspection.json', result.generated_sql_inspection);
    phase('immutable_offline_sql_validated');
    const container = JSON.parse(cp.execFileSync('docker', ['inspect', 'roi-close-atomic-test-20261003'], { encoding: 'utf8', timeout: Math.min(15000, remaining() - 10000) }))[0];
    assert.equal(container.State.Status, 'running');
    const binding = container.NetworkSettings.Ports['5432/tcp'][0];
    assert.equal(binding.HostIp, '127.0.0.1'); assert.equal(binding.HostPort, '55439');
    const vars = Object.fromEntries(container.Config.Env.map(value => { const i = value.indexOf('='); return [value.slice(0, i), value.slice(i + 1)]; }));
    assert.equal(vars.POSTGRES_DB, 'crypto_reset_test');
    const url = new URL('postgresql://127.0.0.1:55439/crypto_reset_test'); url.username = vars.POSTGRES_USER; url.password = vars.POSTGRES_PASSWORD;
    url.searchParams.set('connection_limit', '1');
    database = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    phase('apply_transaction_started'); result.apply_transactions++;
  const actual = await database.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout='10000ms'");
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout='3000ms'");
    const existing = await tx.$queryRawUnsafe('SELECT 1 FROM pg_namespace WHERE nspname=$1', schema);
    assert.equal(existing.length, 0, 'new_schema_already_exists_no_reset');
    await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
    for (const statement of inspected.statements) await tx.$executeRawUnsafe(statement);
    await tx.$executeRawUnsafe('SET LOCAL search_path TO pg_catalog');
    const metadata = await tx.$queryRawUnsafe(`SELECT c.relname AS table_name,jsonb_build_object(
      'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
      'constraints',(SELECT jsonb_agg(jsonb_build_object('name',co.conname,'definition',pg_get_constraintdef(co.oid,true)) ORDER BY co.conname) FROM pg_constraint co WHERE co.conrelid=c.oid),
      'indexes',(SELECT jsonb_agg(pg_get_indexdef(i.indexrelid) ORDER BY ci.relname) FROM pg_index i JOIN pg_class ci ON ci.oid=i.indexrelid WHERE i.indrelid=c.oid)
      ) AS definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname=$1 ORDER BY c.relname`, schema);
    assert.deepEqual(normalizeMetadata(metadata, schema), normalizeMetadata(reference, registration.catalog_expected.reference_schema), 'new_schema_catalog_parity_mismatch');
    const sequences = await tx.$queryRawUnsafe(`SELECT s.relname AS sequence_name,n.nspname AS sequence_schema,tn.nspname AS table_schema,t.relname AS table_name,a.attname AS column_name,pg_get_expr(ad.adbin,ad.adrelid) AS column_default FROM pg_class s JOIN pg_namespace n ON n.oid=s.relnamespace LEFT JOIN pg_depend dep ON dep.objid=s.oid AND dep.classid='pg_class'::regclass AND dep.refclassid='pg_class'::regclass AND dep.deptype='a' LEFT JOIN pg_class t ON t.oid=dep.refobjid LEFT JOIN pg_namespace tn ON tn.oid=t.relnamespace LEFT JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=dep.refobjsubid LEFT JOIN pg_attrdef ad ON ad.adrelid=t.oid AND ad.adnum=a.attnum WHERE s.relkind='S' AND n.nspname=$1 ORDER BY s.relname`, schema);
    const serialTables = [...schemaText.matchAll(/^model \w+ \{([\s\S]*?)^\}/gm)].filter(m => m[1].includes('@default(autoincrement())')).map(m => m[1].match(/@@map\("([a-z_]+)"\)/)[1]).sort();
    assert.equal(sequences.length, 23, 'new_owned_serial_sequence_count');
    assert.deepEqual(sequences.map(s => s.table_name).sort(), serialTables);
    for (const sequence of sequences) {
      assert.equal(sequence.sequence_schema, schema); assert.equal(sequence.table_schema, schema); assert.equal(sequence.column_name, 'id');
      assert.equal(sequence.sequence_name, sequence.table_name + '_id_seq');
      assert.equal(sequence.column_default, `nextval('${schema}.${sequence.sequence_name}'::regclass)`, 'new_sequence_default_not_new_namespace');
    }
    const counts = await tx.$queryRawUnsafe(tables.map(table => `SELECT '${table}' AS table_name,count(*)::int AS row_count FROM "${schema}"."${table}"`).join(' UNION ALL '));
    assert.equal(counts.length, 24); assert(counts.every(row => row.row_count === 0), 'new_namespace_business_rows_not_empty');
    assert(remaining() > 10000, 'registered_wall_before_commit_exhausted');
    return { metadata, sequences, counts };
  }, { timeout: Math.min(60000, remaining() - 10000), maxWait: 10000 });

    result.committed = true;
    write('catalog-parity.json', { passed: true, reference_sha256: sha(referenceFile), normalized_namespace_only: true, expected, ...actual });
    phase('new_namespace_committed_verified_empty');
    result.status = 'fresh_research_namespace_bootstrapped'; result.passed = true;
  } catch (error) {
    failure = error; result.status = 'bootstrap_failed'; result.failure = error.message; result.failure_code = error.code ?? null;
    result.rollback_required_on_apply_failure = result.apply_transactions === 1 && !result.committed;
  } finally {
    if (database) { try { await database.$disconnect(); } catch (error) { failure ??= error; result.disconnect_failure = error.code ?? error.name; result.passed = false; } }
    result.completed_at = new Date().toISOString(); result.elapsed_ms = Date.now() - startedAt;
    result.within_registered_deadline = Date.now() <= deadline;
    if (!result.within_registered_deadline) { failure ??= Error('bootstrap_registered_wall_exhausted'); result.status = 'bootstrap_deadline_exceeded'; result.passed = false; }
    write('result.json', result);
  }
  if (failure) throw failure;
  return result;
}
module.exports = { prepareEmptyResearchSchemaOffline };

'use strict';

// One preregistered local DDL generation and one atomic, new research namespace.
const startedAt = Date.now();
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'docs/audits/2026-10-09-prisma-offline-bootstrap');
const registrationFile = path.join(audit, 'registration.json');
const registration = JSON.parse(fs.readFileSync(registrationFile, 'utf8'));
const schema = registration.target_schema;
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write = (name, value) => fs.writeFileSync(path.join(audit, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const remaining = () => Math.min(600000 - (Date.now() - startedAt), Date.parse(registration.deadline_utc) - Date.now());
const phase = name => {
  assert(remaining() > 10000, 'registered_wall_budget_exhausted');
  result.phases.push({ name, at: new Date().toISOString(), elapsed_ms: Date.now() - startedAt });
};
const result = {
  version: registration.version, started_at: new Date(startedAt).toISOString(),
  target_schema: schema, status: 'starting', passed: false, provider_calls: 0,
  ddl_generations: 0, apply_transactions: 0, committed: false,
  phases: [], production_touched: false, existing_schemas_mutated: false,
  index_installed: false, journal_installed: false, account_seeded: false,
  economic_goal_proven: false, promotion_allowed: false,
};
let database;

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
  assert.equal((sql.match(/^\s+"[a-z_]+"\s+[A-Z]/gm) ?? []).length, 325, 'generated_column_count');
  assert(!/"public"\.|\bpublic\.|CREATE SCHEMA|DROP|TRUNCATE/.test(sql), 'generated_sql_outside_target_namespace');
  return { statements, created_tables: created, explicit_indexes: indexes, foreign_keys: foreignKeys };
}

async function main() {
  assert.equal(registration.version, 'prisma-offline-fresh-research-bootstrap-v1');
  assert.equal(registration.max_wall_seconds, 600);
  assert.equal(registration.max_new_provider_calls, 0);
  assert.equal(registration.ddl_generation_max, 1);
  assert.equal(registration.database_apply_transactions_max, 1);
  assert(/^engine_[a-zA-Z0-9_]{1,55}$/.test(schema), 'strict_new_research_schema_required');
  for (const [file, expected] of Object.entries(registration.sources_before)) assert.equal(sha(path.join(root, file)), expected, 'registered_source_identity:' + file);
  assert.equal(require('../node_modules/prisma/package.json').version, '5.22.0');
  assert.equal(sha(path.join(root, 'backend/prisma/schema.prisma')), 'cbff9d78d3bf4f3a8e14692513e64f33f9f319351f1b6701c7ab45b744f09d42');
  const referenceFile = path.join(root, 'docs/audits/2026-10-09-unused-schema-recovery/schema-readonly-stdout.json');
  const original = JSON.parse(fs.readFileSync(referenceFile, 'utf8'));
  const reference = original.metadata.filter(row => row.schema === registration.catalog_expected.reference_schema);
  const tables = reference.map(row => row.table_name).sort();
  assert.equal(tables.length, 24);
  const schemaText = fs.readFileSync(path.join(root, 'backend/prisma/schema.prisma'), 'utf8');
  assert.deepEqual([...schemaText.matchAll(/@@map\("([a-z_]+)"\)/g)].map(m => m[1]).sort(), tables);
  result.source_hashes = { ...registration.sources_before, [path.relative(root, __filename)]: sha(__filename), registration: sha(registrationFile) };
  write('source-manifest.json', result.source_hashes);

  phase('offline_generation_started');
  const ddlFile = path.join(audit, 'prisma-from-empty.sql');
  assert(!fs.existsSync(ddlFile), 'new_generation_artifact_required');
  const args = ['migrate', 'diff', '--from-empty', '--to-schema-datamodel', path.join(root, 'backend/prisma/schema.prisma'), '--script', '--output', ddlFile];
  result.ddl_generations++;
  const generated = cp.spawnSync(path.join(root, 'backend/node_modules/.bin/prisma'), args, {
    cwd: root, encoding: 'utf8', timeout: Math.min(90000, remaining() - 10000),
    env: { ...process.env, DATABASE_URL: 'postgresql://offline:offline@127.0.0.1:1/offline', CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' },
  });
  fs.writeFileSync(path.join(audit, 'generation.stdout.txt'), generated.stdout ?? '', { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(path.join(audit, 'generation.stderr.txt'), generated.stderr ?? '', { flag: 'wx', mode: 0o600 });
  result.generation = { exit_code: generated.status, signal: generated.signal, error_code: generated.error?.code ?? null, args };
  assert.equal(generated.status, 0, 'offline_generation_failed');
  fs.chmodSync(ddlFile, 0o600);
  const sql = fs.readFileSync(ddlFile, 'utf8');
  const inspected = validateGeneratedSql(sql, tables);
  result.generated_sql_sha256 = sha(ddlFile);
  result.generated_sql_inspection = { statements: inspected.statements.length, tables: inspected.created_tables.length,
    explicit_indexes: inspected.explicit_indexes.length, foreign_keys: inspected.foreign_keys.length, serial_sequences: 23, columns: 325, qualified_other_namespaces: false };
  write('generated-sql-inspection.json', result.generated_sql_inspection);
  phase('offline_generation_validated');

  // Only the explicit research Docker endpoint; secrets stay inside this process.
  const container = JSON.parse(cp.execFileSync('docker', ['inspect', 'roi-close-atomic-test-20261003'], { encoding: 'utf8', timeout: Math.min(15000, remaining() - 10000) }))[0];
  assert.equal(container.State.Status, 'running');
  const binding = container.NetworkSettings.Ports['5432/tcp'][0];
  assert.equal(binding.HostIp, '127.0.0.1'); assert.equal(binding.HostPort, '55439');
  const vars = Object.fromEntries(container.Config.Env.map(value => { const i = value.indexOf('='); return [value.slice(0, i), value.slice(i + 1)]; }));
  assert.equal(vars.POSTGRES_DB, 'crypto_reset_test');
  const url = new URL('postgresql://127.0.0.1:55439/crypto_reset_test'); url.username = vars.POSTGRES_USER; url.password = vars.POSTGRES_PASSWORD;
  url.searchParams.set('connection_limit', '1');
  database = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  phase('apply_transaction_started');
  result.apply_transactions++;
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
  write('catalog-parity.json', { passed: true, reference_sha256: sha(referenceFile), normalized_namespace_only: true, expected: registration.catalog_expected, ...actual });
  phase('new_namespace_committed_verified_empty');
  result.status = 'fresh_research_namespace_bootstrapped'; result.passed = true;
}

main().catch(error => {
  result.status = 'bootstrap_failed'; result.failure = error.message; result.failure_code = error.code ?? null;
  result.passed = false; result.rollback_required_on_apply_failure = result.apply_transactions === 1 && !result.committed;
  process.exitCode = 1;
}).finally(async () => {
  if (database) { try { await database.$disconnect(); } catch (error) { result.disconnect_failure = error.code ?? error.name; result.passed = false; process.exitCode = 1; } }
  result.completed_at = new Date().toISOString(); result.elapsed_ms = Date.now() - startedAt;
  result.within_registered_deadline = Date.now() <= Date.parse(registration.deadline_utc);
  if (!result.within_registered_deadline) { result.passed = false; result.status = 'bootstrap_reporting_deadline_exceeded'; process.exitCode = 1; }
  write('result.json', result);
  const summary = `# Offline research namespace bootstrap\n\n${result.passed ? 'PASS' : 'FAIL'}: ${result.status}. One local DDL generation (${result.ddl_generations}) and research apply transaction (${result.apply_transactions}); committed=${result.committed}. Wall ${result.elapsed_ms}ms; registered deadline respected=${result.within_registered_deadline}.\n\nTarget: ${schema}. Existing schemas and live state were preserved. Index, journal and account seed were not installed. Provider calls 0. This proves bootstrap/catalog integrity only; throughput, fills and ROI remain unmeasured.\n${result.failure ? '\nFailure: ' + result.failure + '\n' : ''}`;
  fs.writeFileSync(path.join(audit, 'report.md'), summary, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: result.status, passed: result.passed, committed: result.committed, elapsed_ms: result.elapsed_ms, target_schema: schema, provider_calls: 0, economic_goal_proven: false }));
});

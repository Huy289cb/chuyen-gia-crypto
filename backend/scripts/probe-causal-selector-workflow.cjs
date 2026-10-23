'use strict';
// One preregistered, previously observed H2 plan through the shared workflow.
// Exchange adapters remain modeled; only the pinned primary reviewer uses network.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { PrismaClient } = require('@prisma/client');
const { createProductionPortfolioRuntime } = require('./production-portfolio-runtime.cjs');
const { createPortfolioCommandJournal } = require('./portfolio-command-journal-server-gap.cjs');
const { createHistoricalCandleAdapter } = require('./historical-candle-adapter.cjs');
const { createHistoricalMarketAdapter } = require('./historical-market-adapter.cjs');
const { createHistoricalExchangeLedger } = require('./historical-exchange-ledger.cjs');
const { createHistoricalOrderExchange } = require('./historical-order-exchange.cjs');

const startedAt = Date.now();
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'docs/audits/2026-10-08-causal-selector');
const out = path.join(audit, 'workflow-probe');
const schema = 'engine_causal_selector_20261009';
const registrationFile = path.join(audit, 'registration.json');
const inputFile = path.join(root, 'docs/audits/2026-10-07-h2-permission-boundary/workflow-input.json');
const policyFile = path.join(root, 'docs/audits/2026-10-08-disk-candidate-first/policy.json');
const baseRuntime = path.join(root, 'docs/audits/2026-10-07-h2-permission-boundary/workflow-schema-probe/runtime');
const datasetFile = path.join(root, 'docs/audits/2026-09-11-opportunity-testbed/train-data.json');
const runtimeRoot = path.join(out, 'runtime');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
if (fs.existsSync(out)) throw new Error('new_probe_directory_required');
fs.mkdirSync(out, { mode: 0o700 });
const write = (name, value) => {
  const file = path.join(out, name), temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file);
};

let database, runtime, exchange, journal, providerAbort;
let at, manifest, stopping = false, providerInFlight = false;
let timer;
const report = {
  version: 'causal-review-selector-v1', scope: 'one known H2 development plan, actual shared reviewer/executor with modeled exchange; not portfolio profitability',
  schema, production_touched: false, frozen_runtime_touched: false,
  started_at: new Date(startedAt).toISOString(), status: 'starting', passed: false,
  provider_calls: 0, reported_cost_usd: 0, provider_cost_unknown: false,
  network_receipts: [], steps: [], orders: 0,
  economic_roi: null, stress_roi: null, independent_fill_uplift: null,
  terminal_export_complete: false,
};

function remainingMs() {
  return Math.max(0, 600000 - (Date.now() - startedAt));
}
function checkpoint() {
  report.elapsed_wall_ms = Date.now() - startedAt;
  write('checkpoint.json', report);
}
function failStop(reason) {
  stopping = true;
  report.stop = reason;
  throw new Error(reason);
}
function runtimeHashes(dir) {
  const files = {};
  function walk(current) {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, item.name);
      if (item.isDirectory()) walk(file);
      else if (item.name.endsWith('.js')) files[path.relative(dir, file)] = sha(file);
    }
  }
  walk(dir);
  return files;
}
function sameFileAsRegistered(registration, file) {
  const relative = path.relative(root, file);
  assert.equal(sha(file), registration.sources_before[relative], 'registered input identity: ' + relative);
}

async function captureTerminal() {
  if (exchange) report.exchange = exchange.snapshot();
  if (runtime) {
    report.diagnostics = runtime.diagnostics();
    try {
      const state = await runtime.snapshot();
      write('terminal-state.json', state);
      report.terminal_account = state.accounts;
      report.pending_count = state.pending.length;
      report.position_count = state.positions.filter(position => position.status === 'open').length;
      report.terminal_export_complete = true;
    } catch {
      report.terminal_capture_failure = 'terminal_state_unavailable';
    }
  }
  if (database) {
    try {
      report.trade_decision_count = await database.tradeDecision.count();
      if (journal) report.terminal_command_gaps = await journal.gaps();
      if (Number.isFinite(at)) {
        report.provider_journal = await database.$queryRawUnsafe(
          'SELECT request_id,event_type,metadata FROM public.provider_request_journal WHERE request_id LIKE $1 ORDER BY recorded_at',
          String(at) + '-' + process.pid + '-%'
        );
      }
      write('events.json', await database.testnetTradeEvent.findMany({ orderBy: { id: 'asc' } }));
    } catch {
      report.terminal_capture_failure = 'terminal_journal_unavailable';
      report.terminal_export_complete = false;
    }
  }
}

(async () => {
  const registration = read(registrationFile);
  assert.equal(registration.version, report.version);
  assert.equal(registration.capital_usd, 31.47744546);
  assert.equal(registration.wall_seconds_max, 600);
  assert.equal(registration.provider_budget.new_requests_max, 4);
  assert.equal(registration.provider_budget.reported_usd_max, 0.05);
  assert.equal(registration.provider_budget.stop_on_unknown_cost, true);
  assert.equal(registration.provider_budget.model_change, false);
  assert.equal(registration.live_deployment, false);
  sameFileAsRegistered(registration, inputFile);
  sameFileAsRegistered(registration, policyFile);
  sameFileAsRegistered(registration, path.join(root, 'backend/src/utils/causal-plan-contract.ts'));
  const input = read(inputFile), policy = read(policyFile);
  const candidate = input.row.candidate, geometry = input.row.plan;
  assert.equal(input.row.status, 'plan');
  assert.equal(input.row.window, true);
  assert.equal(geometry.status, 'plan');
  assert.equal(candidate.side, 'long');
  at = input.evidence.at;
  assert(Number.isFinite(at));
  const bridge = read(path.join(root, 'docs/audits/2026-10-07-h2-permission-boundary/bridge-verification.json'));
  assert.deepEqual(bridge.accepted, [candidate.id]);
  report.input = { setup_id: candidate.id, mechanism: 'H2', at, input_sha256: sha(inputFile), policy_sha256: sha(policyFile) };
  report.registration_sha256 = sha(registrationFile);
  report.script_sha256 = sha(__filename);
  report.status = 'setup';
  timer = setTimeout(() => {
    stopping = true;
    providerAbort?.abort();
    report.status = 'failed_cutoff';
    report.stop = report.failure = 'registered_wall_cutoff';
    report.passed = false;
    report.terminal_export_complete = false;
    if (exchange) report.exchange = exchange.snapshot();
    if (runtime) report.diagnostics = runtime.diagnostics();
    checkpoint();
    write('proof.json', report);
    console.log(JSON.stringify({ passed: false, stop: report.stop, provider_calls: report.provider_calls }));
    process.exit(124);
  }, remainingMs());

  // The source runtime is retained unchanged; only these two modules are overlaid.
  const overlays = ['services/groq-dispatch.service', 'utils/causal-plan-selector'];
  const originalHashes = runtimeHashes(baseRuntime);
  fs.cpSync(baseRuntime, runtimeRoot, { recursive: true });
  manifest = {
    compilation: 'registered old workflow runtime plus only current dispatcher and selector transpilation; focused unit tests recorded separately, full semantic build not run',
    base_runtime: path.relative(root, baseRuntime), base_runtime_hashes: originalHashes,
    source_hashes: {}, runtime_hashes: {}, overlays,
    input_sha256: sha(inputFile), policy_sha256: sha(policyFile), dataset_sha256: sha(datasetFile),
  };
  for (const relative of overlays) {
    const file = path.join(root, 'backend/src', relative + '.ts');
    manifest.source_hashes[relative] = sha(file);
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
      reportDiagnostics: true,
    });
    if (compiled.diagnostics.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)) {
      failStop('overlay_transpile_failed:' + relative);
    }
    fs.writeFileSync(path.join(runtimeRoot, relative + '.js'), compiled.outputText, { mode: 0o600 });
  }
  manifest.runtime_hashes = runtimeHashes(runtimeRoot);
  for (const [file, digest] of Object.entries(originalHashes)) {
    if (!overlays.includes(file.replace(/\.js$/, ''))) assert.equal(manifest.runtime_hashes[file], digest);
  }
  write('runtime-manifest.json', manifest);

  const container = JSON.parse(cp.execFileSync('docker', ['inspect', 'roi-close-atomic-test-20261003'], {
    encoding: 'utf8', timeout: Math.min(15000, remainingMs()),
  }))[0];
  assert.equal(container.State.Status, 'running');
  assert.equal(container.NetworkSettings.Ports['5432/tcp'][0].HostPort, '55439');
  assert.equal(container.NetworkSettings.Ports['5432/tcp'][0].HostIp, '127.0.0.1');
  const databaseVars = Object.fromEntries(container.Config.Env.map(value => {
    const index = value.indexOf('='); return [value.slice(0, index), value.slice(index + 1)];
  }));
  assert.equal(databaseVars.POSTGRES_DB, 'crypto_reset_test');
  assert(databaseVars.POSTGRES_USER && databaseVars.POSTGRES_PASSWORD, 'isolated credentials required');
  const databaseUrl = new URL('postgresql://' + encodeURIComponent(databaseVars.POSTGRES_USER) + ':' +
    encodeURIComponent(databaseVars.POSTGRES_PASSWORD) + '@127.0.0.1:55439/crypto_reset_test');
  databaseUrl.searchParams.set('schema', schema);
  database = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });
  const previousSchema = await database.$queryRawUnsafe('SELECT 1 FROM pg_namespace WHERE nspname=$1', schema);
  assert.equal(previousSchema.length, 0, 'fresh isolated schema required');
  const [providerTable] = await database.$queryRawUnsafe("SELECT to_regclass('public.provider_request_journal')::text AS relation");
  assert(providerTable.relation, 'existing independent provider journal required');
  const setup = cp.spawnSync(path.join(root, 'backend/node_modules/.bin/prisma'), ['db', 'push', '--skip-generate'], {
    cwd: path.join(root, 'backend'), env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
    encoding: 'utf8', timeout: Math.min(60000, remainingMs()),
  });
  if (setup.status !== 0) failStop('isolated_schema_setup_failed');
  assert.equal(await database.testnetAccount.count(), 0);
  const account = await database.testnetAccount.create({ data: {
    symbol: 'BTC', method_id: 'kim_nghia', starting_balance: registration.capital_usd,
    current_balance: registration.capital_usd, equity: registration.capital_usd,
    created_at: new Date(at), updated_at: new Date(at),
  } });
  journal = createPortfolioCommandJournal({ database, positionId: 'pipeline_v3_kim_nghia', storageSchema: schema });

  const workers = JSON.parse(cp.execFileSync('pm2', ['jlist'], {
    encoding: 'utf8', timeout: Math.min(15000, remainingMs()), maxBuffer: 10485760,
  }));
  const worker = workers.find(process => process.name === 'crypto-worker' && process.pm2_env.status === 'online');
  if (!worker?.pid) failStop('online_worker_key_source_missing');
  const liveEnvironment = Object.fromEntries(fs.readFileSync('/proc/' + worker.pid + '/environ', 'utf8')
    .split('\0').filter(Boolean).map(value => {
      const index = value.indexOf('='); return [value.slice(0, index), value.slice(index + 1)];
    }));
  const providerKeys = Object.fromEntries(Object.entries(liveEnvironment)
    .filter(([key]) => /^(OPENROUTER_API_KEY|GROQ_API_KEY(?:_\d+)?|CEREBRAS_API_KEY)$/.test(key)));
  if (!providerKeys.OPENROUTER_API_KEY) failStop('required_primary_provider_key_missing');
  report.key_source = { process_name: worker.name, pid: worker.pid, key_names: Object.keys(providerKeys) };
  const environment = {
    ...policy.environment,
    CAUSAL_OPPORTUNITY_RESEARCH_ENABLED: 'true',
    CAUSAL_REVIEW_CONTRACT: 'selector-v1', CAUSAL_REVIEW_RESPONSE_FORMAT: 'json_object',
    OPENROUTER_SHADOW_MODEL: '',
  };
  write('policy.json', { base_policy_sha256: sha(policyFile), environment,
    overrides: ['CAUSAL_OPPORTUNITY_RESEARCH_ENABLED', 'CAUSAL_REVIEW_CONTRACT', 'CAUSAL_REVIEW_RESPONSE_FORMAT', 'OPENROUTER_SHADOW_MODEL'] });

  const candles = createHistoricalCandleAdapter({ datasetPath: datasetFile, expectedSha256: manifest.dataset_sha256, readClock: () => at });
  const ledger = createHistoricalExchangeLedger({ seedAt: at, readClock: () => at });
  exchange = createHistoricalOrderExchange({ seedAt: at, capital: registration.capital_usd, readClock: () => at,
    ledger, feeRate: 0.0005, minQty: 0.001, stepSize: 0.001, minNotional: 50, fundingRows: read(datasetFile).funding });
  const market = createHistoricalMarketAdapter({ datasetPath: datasetFile, expectedSha256: manifest.dataset_sha256, readClock: () => at, candleAdapter: candles });
  const exposure = async () => await database.testnetPosition.findMany({ where: { status: 'open' } });
  const priceView = async symbol => {
    const bar = candles.getCandles({ symbol, timeframe: '1m', limit: 1 }).candles.at(-1);
    if (!bar) throw new Error('price_history_missing');
    return { price: bar.close, open: bar.open, high: bar.high, low: bar.low, volume: bar.volume, time: new Date(bar.timestamp).toISOString() };
  };
  let scans = {}, plan;
  const adapters = {
    'services/price-fetcher': { fetchPrices: priceView, fetchPricesFromDb: priceView },
    'services/binanceClient': exchange.adapter,
    'services/binance-hedge-mode': { ensurePositionModeDetected: async () => {}, isHedgeMode: () => false, getPositionMode: () => 'ONE_WAY' },
    'services/binance-account-health.service': { checkBinanceAccountTradable: async () => ({ tradable: true, basis: 'modeled exchange health' }), isBinanceDemoMetadataUnavailableError: () => false },
    'services/binance/account': {
      getAccount: async () => { const state = exchange.snapshot(); return { assets: [{ asset: 'USDT', walletBalance: state.wallet }], totalWalletBalance: state.wallet, totalUnrealizedProfit: state.unrealizedPnl, totalMarginBalance: state.equity }; },
      getPositionRisk: async () => { const state = exchange.snapshot(); return state.quantity ? [{ symbol: 'BTCUSDT', positionAmt: String(state.quantity), markPrice: String(state.markPrice) }] : []; },
    },
    'services/telegram/telegram-hooks': { hookPendingOrderPlaced: () => {}, hookPendingCancelled: () => {}, hookEntryFilled: () => {} },
    'services/telegram/telegram-notify.service': { notifyFromTradeEvent: async () => {} },
    'services/binance/market': market, 'services/candle.service': candles,
    'services/binance/trading': ledger.tradingAdapter,
    'services/binance/client': { get: async (endpoint, params) => {
      if (!String(endpoint).includes('income')) throw new Error('unsupported_historical_raw_endpoint');
      return ledger.incomeAdapter.fetchBinanceIncomeRows({ symbol: 'BTC', startTime: Number(params.startTime), endTime: Number(params.endTime), limit: Number(params.limit) });
    } },
    'services/binance-exposure.service': {
      hasBinanceExposureForSide: async (_symbol, side) => (await exposure()).some(position => position.side === side),
      fetchActiveBinancePositions: async () => { const state = exchange.snapshot(); return state.quantity ? [{ symbol: 'BTC', side: state.quantity > 0 ? 'long' : 'short', positionAmt: Math.abs(state.quantity), entryPrice: state.average, markPrice: state.markPrice }] : []; },
      fetchBinanceNetPosition: async () => { const state = exchange.snapshot(); return state.quantity ? { symbol: 'BTC', side: state.quantity > 0 ? 'long' : 'short', positionAmt: state.quantity, markPrice: state.markPrice } : null; },
    },
    'schedulers/market-scan.scheduler': { getScanResult: (_symbol, timeframe) => scans[timeframe] },
  };

  // Preserve original client/validator execution. Stop further paid calls after the
  // first invalid contract/error; the transport never rewrites the returned body.
  adapters.providerFetch = async (url, options) => {
    if (stopping || report.provider_cost_unknown || providerInFlight || remainingMs() === 0 ||
        report.provider_calls >= registration.provider_budget.new_requests_max ||
        report.reported_cost_usd >= registration.provider_budget.reported_usd_max) {
      throw new Error('registered_provider_budget_or_stop');
    }
    const target = new URL(url), body = JSON.parse(options.body);
    if (target.origin !== 'https://openrouter.ai' || target.pathname !== '/api/v1/chat/completions' ||
        options.method !== 'POST' || body.model !== environment.OPENROUTER_DISPATCH_MODEL ||
        body.response_format?.type !== 'json_object') failStop('provider_model_endpoint_or_contract_changed');
    const receipt = { at, url: target.origin + target.pathname, body, status: null, cost_usd: null };
    report.network_receipts.push(receipt);
    report.provider_calls++;
    providerInFlight = true;
    checkpoint();
    providerAbort = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, providerAbort.signal]) : providerAbort.signal;
    try {
      const response = await fetch(url, { ...options, signal });
      receipt.status = response.status;
      receipt.response = await response.clone().json();
      const cost = receipt.response?.usage?.cost;
      if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) {
        report.provider_cost_unknown = true;
        stopping = true;
        report.stop = 'provider_cost_unknown';
      } else {
        receipt.cost_usd = cost;
        report.reported_cost_usd += cost;
      }
      if (report.reported_cost_usd > registration.provider_budget.reported_usd_max) {
        stopping = true;
        report.stop = 'registered_provider_cost_exceeded';
      }
      if (!response.ok) { stopping = true; report.stop = 'provider_http_error'; }
      const content = receipt.response?.choices?.[0]?.message?.content;
      if (response.ok && typeof content === 'string') {
        const parsed = runtime.load('utils/llm-json').parseLlmJsonObject(content);
        const selected = runtime.load('utils/causal-plan-selector').decodeCausalPlanSelector(parsed, plan, 'BTC', '5m', at);
        receipt.selector_contract = { valid: selected.analysis !== null, action: selected.analysis?.action, confidence: selected.analysis?.confidence, reason: selected.reason };
        if (!selected.analysis) { stopping = true; report.stop = selected.reason ?? 'selector_contract_invalid'; }
      } else if (response.ok) {
        stopping = true; report.stop = 'provider_content_invalid';
      }
      write('provider-receipts.json', report.network_receipts);
      checkpoint();
      if (report.provider_cost_unknown || report.reported_cost_usd > registration.provider_budget.reported_usd_max) {
        throw new Error(report.stop);
      }
      return response;
    } catch {
      stopping = true;
      report.stop ??= 'provider_transport_failed';
      receipt.transport_failure = report.stop;
      if (receipt.cost_usd === null) report.provider_cost_unknown = true;
      write('provider-receipts.json', report.network_receipts);
      checkpoint();
      throw new Error(report.stop);
    } finally {
      providerInFlight = false;
      providerAbort = undefined;
    }
  };

  runtime = createProductionPortfolioRuntime({ runtimeRoot, database, environment: { ...environment, ...providerKeys },
    externalAdapters: adapters, initialClock: at, commandJournal: journal, externalStateSnapshot: () => exchange.snapshot() });
  await runtime.load('repositories/testnet.repository').ensurePipelineEventPosition(account.id);
  await journal.prepare();
  const initial = await runtime.snapshot();
  report.initial_account = initial.accounts;
  write('initial-state.json', initial);
  const risk = runtime.load('config/risk-policy').getRiskPolicy();
  assert.equal(risk.maxEffectiveRiskPerTradePercent, 5);
  assert.equal(risk.maxEffectiveRiskPerTradeUsd, null);
  assert.equal(risk.dailyLossLimitPercent, 10);
  assert.equal(risk.consecutiveLossCooldownHours, 1);
  assert.equal(risk.minSlDistancePercent, 0.008);
  assert.equal(risk.riskPerTradePercent, 0.5);
  assert.equal(risk.maxTotalExposureUsd, 100);
  assert.equal(risk.circuitDrawdownEnabled, false);
  report.effective_risk_policy = risk;
  plan = runtime.load('utils/causal-plan-contract').sealCausalPlan({
    version: 'h1-h2-review-v1', setupId: candidate.id, mechanism: 'H2', symbol: 'BTC', timeframe: '5m', side: candidate.side,
    knownAt: candidate.knownAt, expiresAt: candidate.expiresAt, entry: geometry.entry,
    stop: Math.floor(geometry.stop * 10) / 10, target: geometry.target,
    invalidation: geometry.invalidation, minRr: 1.5,
  });
  assert.equal(plan.hash, '138d217cd706209f8735f094574c016dacc524f0159f20d6807d219f48a98c85');
  assert.equal(runtime.load('utils/causal-plan-contract').causalPlanBlock(plan, 'BTC', '5m', at), null);
  report.plan = plan;
  write('sealed-plan.json', plan);
  // Actual HTF analyzer output, never injected grades or confidence.
  const analyzer = runtime.load('analyzers/setup-gate.analyzer');
  for (const [timeframe, key] of [['1h', 'hour'], ['4h', 'fourHour']]) {
    const result = await analyzer.analyzeSetupGate({ symbol: 'BTC', timeframe, candles: input.evidence.bars[key].slice(-100) });
    scans[timeframe] = { timestamp: new Date(at), signalResult: { setupResult: result, gateRegime: result.regime } };
  }
  write('htf-analyzer-results.json', scans);
  exchange.advanceClosedMinute(candles.getCandles({ symbol: 'BTC', timeframe: '1m', limit: 1 }).candles.at(-1));
  report.status = 'reviewing_one_plan';
  checkpoint();
  const result = await runtime.step({ kind: 'causal_review', at, input: {
    symbol: 'BTC', timeframe: '5m', causalPlan: plan, causalEvidence: input.evidence,
    candles: input.evidence.bars.five,
    systemPrompt: runtime.load('config/methods').getMethodConfig('kim_nghia').systemPrompt,
  } });
  report.steps.push({ setup_id: candidate.id, at, mechanism: 'H2', result: result.result });
  report.orders = result.result.execution?.success ? 1 : 0;
  if (!report.orders) assert.equal(result.result.decision, 'no_trade');
  write('command-result.json', result);
  if (stopping) throw new Error(report.stop ?? 'registered_probe_stop');
  await captureTerminal();
  const durable = await journal.recoverCausalInventory(at);
  assert.deepEqual(durable.attemptedSetupIds, [candidate.id]);
  report.inventory = { input_plans: 1, attempted_durable: durable.attemptedSetupIds.length, original_inventory_not_rerun: true };
  report.diagnostics = runtime.diagnostics();
  assert.deepEqual(report.diagnostics.database_errors, []);
  assert.deepEqual(report.diagnostics.adapter_failures, []);
  assert.deepEqual(report.diagnostics.provider_errors, []);
  assert.deepEqual(report.terminal_command_gaps, []);
  assert.equal(report.terminal_export_complete, true);
  for (const [file, digest] of Object.entries(manifest.runtime_hashes)) assert.equal(sha(path.join(runtimeRoot, file)), digest);
  sameFileAsRegistered(registration, inputFile);
  sameFileAsRegistered(registration, policyFile);
  report.selector_contract_status = report.provider_calls ? 'real_response_validated' : 'upstream_guard_stopped_before_provider';
  report.passed = true;
  report.status = 'complete_one_plan';
  report.stop = 'registered_single_plan_processed';
})().catch(error => {
  report.passed = false;
  report.status = 'failed';
  // Avoid arbitrary provider/credential-containing error payloads.
  report.failure = /^[a-z0-9_:. -]+$/i.test(String(error.message)) ? error.message : 'probe_failed_safe_message';
  process.exitCode = 1;
}).finally(async () => {
  try { await captureTerminal(); } catch { report.terminal_export_complete = false; }
  try { if (database) await database.$disconnect(); } catch { report.disconnect_failure = true; }
  if (timer) clearTimeout(timer);
  report.finished_at = new Date().toISOString();
  report.elapsed_wall_ms = Date.now() - startedAt;
  write('proof.json', report);
  console.log(JSON.stringify({ passed: report.passed, status: report.status, provider_calls: report.provider_calls,
    reported_cost_usd: report.reported_cost_usd, pending: report.pending_count, stop: report.stop, failure: report.failure }));
});

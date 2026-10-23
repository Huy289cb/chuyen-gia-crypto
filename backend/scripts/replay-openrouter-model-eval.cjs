const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const evalRoot = path.join(root, process.env.OPENROUTER_EVAL_DIR
  || 'docs/audits/2026-09-26-openrouter-model-eval');
const source = path.join(root, 'docs/audits/2026-09-25-entry-experiments');
const marketRoot = path.join(root, 'docs/audits/2026-09-24-live-testbed');
const read = (file) => JSON.parse(fs.readFileSync(file));
const protocol = read(path.join(marketRoot, 'protocol.json'));

for (const key of Object.keys(process.env)) {
  if (/^(V3_|TRANSITION_|RANGE_|ADAPTIVE_|FUNDING_|CLOSED_|MIN_|MAX_|RISK_|DAILY_|POST_|LOSS_|CONSECUTIVE_|CIRCUIT_|PROFIT_|INVALIDATION_|SIGNAL_GATE_|PENDING_ORDER_)/.test(key)) delete process.env[key];
}
Object.assign(process.env, protocol.policyEnv);

const { replayCoreCandidates } = require('../src/backtest/live-range-execution-replay.ts');
const { getRiskPolicy } = require('../src/config/risk-policy.ts');
const { getAiOpportunityPolicy } = require('../src/config/ai-opportunity-policy.ts');

const responses = read(path.join(evalRoot, 'responses.json'));
const entries = read(path.join(source, 'entries.json'));
const market = read(path.join(marketRoot, 'market.json'));
const threshold = process.env.OPENROUTER_EVAL_THRESHOLD
  ? Number(process.env.OPENROUTER_EVAL_THRESHOLD)
  : null;
const models = [...new Set(responses.map((row) => row.model))]
  .filter((model) => responses.filter((row) => row.model === model).length === entries.length);
const risk = getRiskPolicy();
const policy = { ...getAiOpportunityPolicy(), minRr: 0, ttlMs: 2700000 };
const circuit = {
  maxDrawdownPercent: risk.maxDrawdownPercent,
  drawdownEnabled: risk.circuitDrawdownEnabled,
  expectancyEnabled: risk.circuitExpectancyKillEnabled,
  expectancyWindow: risk.circuitExpectancyWindow,
  expectancyMinSumR: risk.circuitExpectancyMinSumR,
  maxExposurePercentOfEquity: risk.maxExposurePercentOfEquity,
};
const rows = [];
for (const model of ['rules_only', ...models]) {
  const approved = model === 'rules_only' ? null : new Set(responses.filter((row) => {
    if (row.model !== model) return false;
    if (threshold === null) return row.approved;
    const confidence = Number(row.confidence) <= 1 ? Number(row.confidence) * 100 : Number(row.confidence);
    return row.valid && row.action === row.expected && confidence >= threshold;
  }).map((row) => row.id));
  const candidates = entries.filter((entry) => approved === null || approved.has(entry.candidate.id)).map((entry) => entry.candidate);
  for (const slippage of [.001, .002]) {
    const result = replayCoreCandidates({
      bars: market.byTf['1m'], funding: market.funding, candidates,
      start: protocol.start, end: protocol.end, wallet: protocol.wallet,
      policy, circuit, slippage, runtimeProfitProtect: 'fixed_buffer',
    });
    const row = { model, cost: slippage === .001 ? 'base' : 'stress', approved: candidates.length, ...result.summary };
    rows.push(row);
    fs.writeFileSync(path.join(evalRoot, `${model.replaceAll('/', '__')}-${row.cost}.json`), JSON.stringify(result));
  }
}
const portfolioName = threshold === null ? 'portfolio.json' : `portfolio-threshold-${threshold}.json`;
fs.writeFileSync(path.join(evalRoot, portfolioName), JSON.stringify(rows, null, 2));
console.log(JSON.stringify(rows, null, 2));

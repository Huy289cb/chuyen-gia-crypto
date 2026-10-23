require('dotenv').config({ quiet: true });
process.env.NODE_ENV = 'test';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const nativeFetch = global.fetch;
let lastUsage = null;
global.fetch = async (url, options) => {
  const response = await nativeFetch(url, {
    ...options,
    signal: options?.signal ?? AbortSignal.timeout(45_000),
  });
  try {
    const body = await response.clone().json();
    lastUsage = body.usage ?? null;
  } catch {
    lastUsage = null;
  }
  return response;
};

const root = path.resolve(__dirname, '../..');
const source = path.join(root, 'docs/audits/2026-09-25-entry-experiments');
const marketRoot = path.join(root, 'docs/audits/2026-09-24-live-testbed');
const out = path.join(root, 'docs/audits/2026-09-26-openrouter-schema-eval');
fs.mkdirSync(out, { recursive: true });

const read = (file) => JSON.parse(fs.readFileSync(file));
const entries = read(path.join(source, 'entries.json'));
const market = read(path.join(marketRoot, 'market.json'));
const models = [
  'meta-llama/llama-4-scout',
  'qwen/qwen3-30b-a3b-instruct-2507',
  'qwen/qwen3.5-flash-02-23',
  'qwen/qwen3.7-flash',
  'deepseek/deepseek-v4.1-flash',
  'z-ai/glm-5.3-flash',
];
const durations = { '5m': 300000, '1h': 3600000, '4h': 14400000 };
const byTf = Object.fromEntries(Object.entries(market.byTf).map(([tf, bars]) => [tf,
  bars.map((bar) => ({
    timestamp: bar[0], open: bar[1], high: bar[2], low: bar[3], close: bar[4], volume: bar[5],
  })),
]));

function closed(tf, at, limit) {
  return byTf[tf]
    .filter((bar) => bar.timestamp + durations[tf] <= at)
    .slice(-limit)
    .map((bar) => [bar.timestamp, bar.open, bar.high, bar.low, bar.close, Math.round(bar.volume)]);
}

const systemPrompt = 'You are a BTC futures entry veto. Evaluate only the immutable plan using supplied closed candles. Reject weak confirmation, chasing, bad target room, or poor edge after 0.10% round-trip fees and 0.20% round-trip slippage. Do not redesign levels. Return one JSON object with bias, action (buy/sell/hold), confidence (integer 0-100), and reason_summary. Confidence is a rating, not a win probability. Return hold if uncertain.';
const protocol = {
  createdAt: new Date().toISOString(),
  role: 'Strict JSON Schema shadow comparison; no DB writes, AI memory, orders or live decisions.',
  responseFormat: 'json_schema',
  requireParameters: true,
  models,
  cases: entries.length,
  promptHash: crypto.createHash('sha256').update(systemPrompt).digest('hex'),
  sourceEntries: path.relative(root, path.join(source, 'entries.json')),
  marketHash: crypto.createHash('sha256').update(fs.readFileSync(path.join(marketRoot, 'market.json'))).digest('hex'),
  threshold: 80,
  caveat: 'Development cases already observed. Trading PnL can compare filters but cannot establish future edge.',
};
const protocolFile = path.join(out, 'protocol.json');
if (!fs.existsSync(protocolFile)) fs.writeFileSync(protocolFile, JSON.stringify(protocol, null, 2));
else if (JSON.stringify({ ...read(protocolFile), createdAt: protocol.createdAt }) !== JSON.stringify(protocol)) {
  throw new Error('Protocol changed');
}

const resultsFile = path.join(out, 'responses.json');
const results = fs.existsSync(resultsFile) ? read(resultsFile) : [];
const done = new Set(results.map((row) => `${row.model}\0${row.id}`));

async function main() {
  const { analyzeViaOpenRouter } = require('../dist/services/openrouter-client');
  for (const model of models) {
    const priorRows = results.filter((row) => row.model === model);
    if (priorRows.length >= 3 && priorRows.every((row) => !row.valid)) {
      console.log(JSON.stringify({ model, skipped: 'three consecutive invalid responses' }));
      continue;
    }
    if (priorRows.length >= 3 && priorRows.map((row) => row.latencyMs).sort((a, b) => a - b)[1] > 15_000) {
      console.log(JSON.stringify({ model, skipped: 'median latency above 15 seconds' }));
      continue;
    }
    for (const entry of entries) {
      const id = entry.candidate.id;
      if (done.has(`${model}\0${id}`)) continue;
      const plan = entry.candidate;
      const userPrompt = JSON.stringify({
        symbol: 'BTC',
        asOf: new Date(plan.time).toISOString(),
        plan,
        confirmation: entry.confirmation,
        range: {
          low: entry.seed.adaptive_evidence.range_low,
          high: entry.seed.adaptive_evidence.range_high,
        },
        candleColumns: ['timestamp', 'open', 'high', 'low', 'close', 'volume'],
        candles5m: closed('5m', plan.time, 24),
        candles1h: closed('1h', plan.time, 24),
        candles4h: closed('4h', plan.time, 12),
      });
      const started = Date.now();
      lastUsage = null;
      let analysis = null;
      let error = null;
      try {
        analysis = await analyzeViaOpenRouter({
          systemPrompt,
          userPrompt,
          temperature: 0.15,
          model,
          maxParseRetries: 1,
          logLabel: 'SchemaEval',
          responseFormat: 'json_schema',
        });
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
      const expected = plan.side === 'long' ? 'buy' : 'sell';
      const valid = !!analysis && ['buy', 'sell', 'hold'].includes(analysis.action)
        && Number.isFinite(analysis.confidence)
        && analysis.confidence >= 0 && analysis.confidence <= 100;
      results.push({
        model,
        id,
        variant: entry.variant,
        expected,
        latencyMs: Date.now() - started,
        valid,
        approved: valid && analysis.action === expected && analysis.confidence >= 80,
        action: analysis?.action ?? null,
        confidence: analysis?.confidence ?? null,
        reason: analysis?.reason_summary ?? analysis?.reason ?? null,
        error,
        usage: lastUsage,
      });
      done.add(`${model}\0${id}`);
      fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
      console.log(JSON.stringify({
        model,
        completed: results.filter((item) => item.model === model).length,
        valid,
        action: analysis?.action,
        confidence: analysis?.confidence,
        error: error?.slice(0, 120),
      }));
      const modelRows = results.filter((item) => item.model === model);
      if (modelRows.length >= 3 && modelRows.slice(-3).every((item) => !item.valid)) {
        console.log(JSON.stringify({ model, skipped: 'three consecutive invalid responses' }));
        break;
      }
      if (modelRows.length >= 3
        && modelRows.map((item) => item.latencyMs).sort((a, b) => a - b)[Math.floor(modelRows.length / 2)] > 15_000) {
        console.log(JSON.stringify({ model, skipped: 'median latency above 15 seconds' }));
        break;
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

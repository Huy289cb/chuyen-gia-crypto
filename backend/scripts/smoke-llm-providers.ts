/**
 * Cross-provider dispatch smoke: JSON parse, BTC price scale, SL/TP geometry.
 * Usage: cd backend && npx tsx scripts/smoke-llm-providers.ts
 */
import 'dotenv/config';
import { createGroqClient } from '../src/services/groq-client';
import { cleanJSONResponse } from '../src/services/groq-client';
import { getMethodConfig } from '../src/config/methods';
import { GROQ_MODEL_SCOUT } from '../src/config/groq-models';

const SYSTEM = getMethodConfig('kim_nghia').systemPrompt;
const USER = `Symbol: BTC | Timeframe: 15m | Price: 59,200
Regime: trend (bearish HTF 1h) | Grade: B | Playbook: liquidity_sweep
Last 5 candles (OHLC): 59450/59520/59380/59420, 59320/59400/59250/59350, 59200/59300/59180/59240, 59150/59250/59080/59120, 59090/59200/59050/59180
Open position: none | Pending: none
Memory: last 3 shorts stopped out in 6h — avoid revenge short unless fresh sweep.

Return JSON for btc only.`;

interface Candidate {
  provider: string;
  model: string;
  jsonObject?: boolean;
  paid?: boolean;
}

interface Row {
  provider: string;
  model: string;
  jsonObject: boolean;
  ok: boolean;
  ms: number;
  action: string;
  conf: string;
  entry: string;
  sl: string;
  tp: string;
  scaleOk: boolean;
  geometryOk: boolean;
  detail: string;
}

const CANDIDATES: Candidate[] = [
  { provider: 'groq', model: GROQ_MODEL_SCOUT },
  { provider: 'cerebras', model: 'gpt-oss-120b' },
  { provider: 'cerebras', model: 'gpt-oss-120b', jsonObject: true },
  { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free' },
  { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free', jsonObject: true },
  { provider: 'openrouter', model: 'qwen/qwen3-next-80b-a3b-instruct:free', jsonObject: true },
  { provider: 'openrouter', model: 'meta-llama/llama-4-scout', jsonObject: true, paid: true },
];

function extractBtc(parsed: Record<string, unknown>): Record<string, unknown> {
  const btc = parsed.btc;
  return btc && typeof btc === 'object' ? (btc as Record<string, unknown>) : parsed;
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function checkGeometry(
  action: string,
  entry: number | null,
  sl: number | null,
  tp: number | null
): boolean {
  if (!entry || entry <= 0) return action === 'hold';
  if (action === 'hold') return true;
  if (!sl || !tp) return false;
  const a = action.toLowerCase();
  if (a === 'buy' || a === 'long') return sl < entry && tp > entry;
  if (a === 'sell' || a === 'short') return sl > entry && tp < entry;
  return true;
}

function checkScale(entry: number | null, action: string): boolean {
  if (action === 'hold' || entry == null || entry === 0) return true;
  return entry > 1000;
}

async function callOpenAICompat(
  url: string,
  key: string,
  model: string,
  jsonObject: boolean,
  extraHeaders?: Record<string, string>
): Promise<{ content: string; ms: number; error?: string }> {
  const started = Date.now();
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: USER },
    ],
    temperature: 0.15,
    max_tokens: 2048,
  };
  if (jsonObject) body.response_format = { type: 'json_object' };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const ms = Date.now() - started;
  if (!response.ok) return { content: '', ms, error: `${response.status}: ${text.slice(0, 220)}` };

  const data = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
  return { content: data.choices?.[0]?.message?.content ?? '', ms };
}

async function runGroq(model: string): Promise<Row> {
  const client = createGroqClient();
  if (!client) {
    return failRow('groq', model, false, 0, 'no Groq client');
  }
  const t0 = Date.now();
  try {
    const parsed = await client.analyze({
      systemPrompt: SYSTEM,
      userPrompt: USER,
      temperature: 0.15,
      maxRetries: 0,
      preferredModels: [model],
    });
    return scoreRow('groq', model, false, Date.now() - t0, parsed as Record<string, unknown>);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return failRow('groq', model, false, Date.now() - t0, msg.slice(0, 200));
  }
}

async function runCerebras(model: string, jsonObject: boolean): Promise<Row> {
  const key = process.env.CEREBRAS_API_KEY?.trim();
  if (!key) return failRow('cerebras', model, jsonObject, 0, 'missing CEREBRAS_API_KEY');
  const { content, ms, error } = await callOpenAICompat(
    'https://api.cerebras.ai/v1/chat/completions',
    key,
    model,
    jsonObject
  );
  if (error) return failRow('cerebras', model, jsonObject, ms, error);
  const parsed = cleanJSONResponse(content);
  if (!parsed) return failRow('cerebras', model, jsonObject, ms, `JSON fail: ${content.slice(0, 120)}`);
  return scoreRow('cerebras', model, jsonObject, ms, parsed as Record<string, unknown>);
}

async function runOpenRouter(model: string, jsonObject: boolean): Promise<Row> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) return failRow('openrouter', model, jsonObject, 0, 'missing OPENROUTER_API_KEY');
  const { content, ms, error } = await callOpenAICompat(
    'https://openrouter.ai/api/v1/chat/completions',
    key,
    model,
    jsonObject,
    {
      'HTTP-Referer': 'https://download-money-moi.vercel.app',
      'X-Title': 'chuyen-gia-crypto-smoke',
    }
  );
  if (error) return failRow('openrouter', model, jsonObject, ms, error);
  const parsed = cleanJSONResponse(content);
  if (!parsed) return failRow('openrouter', model, jsonObject, ms, `JSON fail: ${content.slice(0, 120)}`);
  return scoreRow('openrouter', model, jsonObject, ms, parsed as Record<string, unknown>);
}

function failRow(
  provider: string,
  model: string,
  jsonObject: boolean,
  ms: number,
  detail: string
): Row {
  return {
    provider,
    model,
    jsonObject,
    ok: false,
    ms,
    action: '-',
    conf: '-',
    entry: '-',
    sl: '-',
    tp: '-',
    scaleOk: false,
    geometryOk: false,
    detail,
  };
}

function scoreRow(
  provider: string,
  model: string,
  jsonObject: boolean,
  ms: number,
  parsed: Record<string, unknown>
): Row {
  const btc = extractBtc(parsed);
  const action = String(btc.action ?? '?').toLowerCase();
  const entry = num(btc.suggested_entry);
  const sl = num(btc.suggested_stop_loss);
  const tp = num(btc.suggested_take_profit);
  const conf = btc.confidence != null ? String(btc.confidence) : '?';
  const scaleOk = checkScale(entry, action);
  const geometryOk = checkGeometry(action, entry, sl, tp);
  const ok = scaleOk && geometryOk;
  return {
    provider,
    model,
    jsonObject,
    ok,
    ms,
    action,
    conf,
    entry: entry == null ? '-' : String(entry),
    sl: sl == null ? '-' : String(sl),
    tp: tp == null ? '-' : String(tp),
    scaleOk,
    geometryOk,
    detail: ok ? 'pass' : `scale=${scaleOk} geometry=${geometryOk}`,
  };
}

async function main(): Promise<void> {
  console.log('=== LLM provider dispatch smoke ===\n');
  const rows: Row[] = [];

  for (const c of CANDIDATES) {
    const label = `${c.provider}/${c.model}${c.jsonObject ? ' +json' : ''}${c.paid ? ' (paid)' : ''}`;
    process.stdout.write(`Testing ${label}... `);
    let row: Row;
    if (c.provider === 'groq') row = await runGroq(c.model);
    else if (c.provider === 'cerebras') row = await runCerebras(c.model, c.jsonObject ?? false);
    else row = await runOpenRouter(c.model, c.jsonObject ?? false);
    rows.push(row);
    console.log(row.ok ? 'PASS' : 'FAIL');
    await new Promise((r) => setTimeout(r, 2500));
  }

  console.log('\n--- Results ---');
  for (const r of rows) {
    const mark = r.ok ? 'PASS' : 'FAIL';
    const j = r.jsonObject ? '+json' : '     ';
    console.log(
      `[${mark}] ${r.provider.padEnd(10)} ${j} ${r.ms}ms | ${r.action} conf=${r.conf} entry=${r.entry} SL=${r.sl} TP=${r.tp}`
    );
    if (!r.ok) console.log(`       ${r.detail}`);
  }

  const passed = rows.filter((r) => r.ok);
  console.log(`\n${passed.length}/${rows.length} passed full quality checks`);
  if (passed.length > 0) {
    console.log('\nRecommended for dispatch (quality pass):');
    for (const r of passed) {
      console.log(`  - ${r.provider}: ${r.model}${r.jsonObject ? ' (json_object)' : ''}`);
    }
  }
}

main();

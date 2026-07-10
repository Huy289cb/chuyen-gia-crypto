/**
 * Score OpenRouter models for dispatch trading quality (not just JSON parse).
 * Usage: cd backend && npx tsx scripts/benchmark-openrouter-trading-quality.ts
 */
import 'dotenv/config';
import { getMethodConfig } from '../src/config/methods';
import { cleanJSONResponse } from '../src/services/groq-client';
import { checkMinSlDistance, computeExpectedRrFromPrices } from '../src/utils/trade-levels';

const OPENROUTER_API_URL =
  process.env.OPENROUTER_API_BASE_URL?.trim() ||
  'https://openrouter.ai/api/v1/chat/completions';

const MODELS = (
  process.env.OPENROUTER_BENCHMARK_MODELS?.split(',').map((s) => s.trim()).filter(Boolean) ?? [
    'meta-llama/llama-4-scout',
    'meta-llama/llama-4-maverick',
    'meta-llama/llama-3.3-70b-instruct',
    'deepseek/deepseek-chat-v3-0324',
    'qwen/qwen3-235b-a22b',
    'google/gemini-2.5-flash-lite',
    'google/gemini-2.5-flash',
    'mistralai/mistral-medium-3',
    'nvidia/nemotron-3-super-120b',
  ]
) as string[];

const CASES = [
  {
    name: '15m-long-sweep',
    userPrompt: `Symbol: BTC | Timeframe: 15m | Price: 63,750
Regime: trend (bullish HTF 1h) | Grade: A | Playbook: liquidity_sweep
Sweep sell-side at 63,680, CHOCH bullish, OB at 63,720-63,740, vol expanding 1.4x avg
Last 5 candles OHLC: 63680/63780/63590/63720, 63700/63820/63650/63750, 63720/63850/63680/63740, 63690/63760/63620/63680, 63650/63720/63600/63710
Open position: none | Pending: none
Memory: no recent losses.

Return JSON for btc only.`,
    expectAction: ['buy', 'hold'] as const,
  },
  {
    name: '5m-short-range',
    userPrompt: `Symbol: BTC | Timeframe: 5m | Price: 64,220
Regime: range (1h range) | Grade: B | Playbook: range_fade
Price at range high 64,260, weak sweep buy-side, vol declining
Last 5 candles OHLC: 64180/64260/64150/64220, 64200/64280/64190/64250, 64220/64300/64210/64270, 64250/64320/64230/64290, 64280/64350/64260/64310
Open position: none | Pending: none
Memory: avoid 5m short in 1h range unless grade A.

Return JSON for btc only.`,
    expectAction: ['sell', 'hold'] as const,
  },
] as const;

interface Score {
  model: string;
  caseName: string;
  ok: boolean;
  ms: number;
  json: boolean;
  geometry: boolean;
  slMin: boolean;
  rrMin: boolean;
  action: string;
  conf: number | null;
  entry: number | null;
  sl: number | null;
  tp: number | null;
  slPct: number | null;
  rr: number | null;
  detail: string;
  total: number;
}

function extractBtc(parsed: Record<string, unknown>): Record<string, unknown> {
  const nested = parsed.btc;
  return nested && typeof nested === 'object' ? (nested as Record<string, unknown>) : parsed;
}

function scoreGeometry(action: string, entry: number, sl: number, tp: number): boolean {
  if (!Number.isFinite(entry) || !Number.isFinite(sl) || !Number.isFinite(tp)) return false;
  if (action === 'buy') return sl < entry && tp > entry;
  if (action === 'sell') return sl > entry && tp < entry;
  return true;
}

async function runCase(model: string, testCase: (typeof CASES)[number]): Promise<Score> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) {
    return {
      model,
      caseName: testCase.name,
      ok: false,
      ms: 0,
      json: false,
      geometry: false,
      slMin: false,
      rrMin: false,
      action: '?',
      conf: null,
      entry: null,
      sl: null,
      tp: null,
      slPct: null,
      rr: null,
      detail: 'missing OPENROUTER_API_KEY',
      total: 0,
    };
  }

  const started = Date.now();
  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://download-money-moi.vercel.app',
        'X-Title': 'chuyen-gia-crypto-trading-benchmark',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: getMethodConfig('kim_nghia').systemPrompt },
          { role: 'user', content: testCase.userPrompt },
        ],
        temperature: 0.15,
        max_tokens: 2048,
        response_format: { type: 'json_object' },
      }),
    });

    const text = await response.text();
    const ms = Date.now() - started;
    if (!response.ok) {
      return {
        model,
        caseName: testCase.name,
        ok: false,
        ms,
        json: false,
        geometry: false,
        slMin: false,
        rrMin: false,
        action: '?',
        conf: null,
        entry: null,
        sl: null,
        tp: null,
        slPct: null,
        rr: null,
        detail: `${response.status}: ${text.slice(0, 160)}`,
        total: 0,
      };
    }

    const data = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? '';
    const parsed = cleanJSONResponse(content);
    if (!parsed) {
      return {
        model,
        caseName: testCase.name,
        ok: false,
        ms,
        json: false,
        geometry: false,
        slMin: false,
        rrMin: false,
        action: '?',
        conf: null,
        entry: null,
        sl: null,
        tp: null,
        slPct: null,
        rr: null,
        detail: `JSON parse fail: ${content.slice(0, 120)}`,
        total: 0,
      };
    }

    const btc = extractBtc(parsed as Record<string, unknown>);
    const action = String(btc.action ?? 'hold').toLowerCase();
    const conf = btc.confidence != null ? Number(btc.confidence) : null;
    const entry = btc.suggested_entry != null ? Number(btc.suggested_entry) : null;
    const sl = btc.suggested_stop_loss != null ? Number(btc.suggested_stop_loss) : null;
    const tp = btc.suggested_take_profit != null ? Number(btc.suggested_take_profit) : null;

    const json = true;
    const geometry =
      action === 'hold' || (entry != null && sl != null && tp != null && scoreGeometry(action, entry, sl, tp));
    const slMin =
      action === 'hold' ||
      (entry != null && sl != null && checkMinSlDistance(entry, sl, 0.008).ok);
    const rr =
      entry != null && sl != null && tp != null
        ? computeExpectedRrFromPrices(entry, sl, tp)
        : null;
    const rrMin = action === 'hold' || (rr != null && rr >= 2);
    const slPct =
      entry != null && sl != null ? Math.abs(entry - sl) / entry : null;

    const total = [json, geometry, slMin, rrMin].filter(Boolean).length;
    const ok = total === 4;

    return {
      model,
      caseName: testCase.name,
      ok,
      ms,
      json,
      geometry,
      slMin,
      rrMin,
      action,
      conf,
      entry,
      sl,
      tp,
      slPct,
      rr,
      detail:
        `action=${action} conf=${conf} entry=${entry} SL=${sl} TP=${tp} ` +
        `slPct=${slPct != null ? (slPct * 100).toFixed(2) : '?'}% rr=${rr?.toFixed(2) ?? '?'}`,
      total,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      model,
      caseName: testCase.name,
      ok: false,
      ms: Date.now() - started,
      json: false,
      geometry: false,
      slMin: false,
      rrMin: false,
      action: '?',
      conf: null,
      entry: null,
      sl: null,
      tp: null,
      slPct: null,
      rr: null,
      detail: msg.slice(0, 160),
      total: 0,
    };
  }
}

async function main(): Promise<void> {
  console.log(`Trading quality benchmark — ${MODELS.length} models × ${CASES.length} cases\n`);
  const all: Score[] = [];

  for (const model of MODELS) {
    for (const testCase of CASES) {
      const result = await runCase(model, testCase);
      all.push(result);
      const mark = result.ok ? 'PASS' : 'FAIL';
      console.log(
        `[${mark}] ${model} / ${testCase.name} (${result.ms}ms) ` +
          `score=${result.total}/4 json=${result.json} geom=${result.geometry} sl=${result.slMin} rr=${result.rrMin}`
      );
      console.log(`       ${result.detail}\n`);
    }
  }

  const byModel = new Map<string, { pass: number; score: number; ms: number }>();
  for (const row of all) {
    const cur = byModel.get(row.model) ?? { pass: 0, score: 0, ms: 0 };
    if (row.ok) cur.pass += 1;
    cur.score += row.total;
    cur.ms += row.ms;
    byModel.set(row.model, cur);
  }

  console.log('=== RANKING (pass cases, then total score, then speed) ===');
  const ranked = [...byModel.entries()].sort((a, b) => {
    if (b[1].pass !== a[1].pass) return b[1].pass - a[1].pass;
    if (b[1].score !== a[1].score) return b[1].score - a[1].score;
    return a[1].ms - b[1].ms;
  });

  for (const [model, stats] of ranked) {
    console.log(
      `${model}: pass ${stats.pass}/${CASES.length}, score ${stats.score}/${CASES.length * 4}, avg ${Math.round(stats.ms / CASES.length)}ms`
    );
  }
}

main();

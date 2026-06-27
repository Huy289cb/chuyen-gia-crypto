/**
 * A/B OpenRouter free models on dispatch-shaped prompt.
 * Usage: cd backend && npm run benchmark:openrouter
 */
import 'dotenv/config';
import { getMethodConfig } from '../src/config/methods';
import { cleanJSONResponse } from '../src/services/groq-client';

const OPENROUTER_API_URL =
  process.env.OPENROUTER_API_BASE_URL?.trim() ||
  'https://openrouter.ai/api/v1/chat/completions';

const DEFAULT_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'qwen/qwen3-coder:free',
] as const;

const USER_PROMPT = `Symbol: BTC | Timeframe: 15m | Price: 59,200
Regime: trend (bearish HTF 1h) | Grade: B | Playbook: liquidity_sweep
Last 5 candles (OHLC): 59450/59520/59380/59420, 59320/59400/59250/59350, 59200/59300/59180/59240, 59150/59250/59080/59120, 59090/59200/59050/59180
Open position: none | Pending: none
Memory: last 3 shorts stopped out in 6h — avoid revenge short unless fresh sweep.

Return JSON for btc only.`;

function modelList(): string[] {
  return (
    process.env.OPENROUTER_BENCHMARK_MODELS?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? [...DEFAULT_MODELS]
  );
}

async function tryModel(model: string, useJsonObject: boolean): Promise<{
  ok: boolean;
  ms: number;
  detail: string;
}> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) return { ok: false, ms: 0, detail: 'missing OPENROUTER_API_KEY' };

  const started = Date.now();
  try {
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: 'system', content: getMethodConfig('kim_nghia').systemPrompt },
        { role: 'user', content: USER_PROMPT },
      ],
      temperature: 0.15,
      max_tokens: 2048,
    };

    if (useJsonObject) {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://download-money-moi.vercel.app',
        'X-Title': 'chuyen-gia-crypto-dispatch-benchmark',
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        ms: Date.now() - started,
        detail: `${response.status}: ${text.slice(0, 220)}`,
      };
    }

    const data = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? '';
    const parsed = cleanJSONResponse(content);
    if (!parsed) {
      return {
        ok: false,
        ms: Date.now() - started,
        detail: `JSON parse failed: ${content.slice(0, 180)}`,
      };
    }

    const btc = (parsed as { btc?: Record<string, unknown> }).btc ?? parsed;
    return {
      ok: true,
      ms: Date.now() - started,
      detail:
        `action=${String(btc.action)} conf=${String(btc.confidence)} ` +
        `entry=${String(btc.suggested_entry)} SL=${String(btc.suggested_stop_loss)} TP=${String(btc.suggested_take_profit)}`,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, ms: Date.now() - started, detail: msg.slice(0, 180) };
  }
}

async function main(): Promise<void> {
  const models = modelList();
  console.log(`OpenRouter models: ${models.join(', ')}\n`);

  for (const model of models) {
    for (const jsonMode of [false, true]) {
      const result = await tryModel(model, jsonMode);
      const mark = result.ok ? 'OK' : 'FAIL';
      console.log(`[${mark}] ${model}${jsonMode ? ' + json_object' : ''} (${result.ms}ms)`);
      console.log(`       ${result.detail}\n`);
    }
  }
}

main();

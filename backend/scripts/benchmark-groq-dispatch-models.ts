/**
 * A/B: dispatch-shaped Groq analyze() on candidate models (uses analyze path, not completeText).
 * Usage: cd backend && npx tsx scripts/benchmark-groq-dispatch-models.ts
 */
import 'dotenv/config';
import { createGroqClient } from '../src/services/groq-client';
import { getMethodConfig } from '../src/config/methods';
import {
  GROQ_DISPATCH_BENCHMARK_MODELS,
  getGroqPrimaryModel,
  getGroqModelChain,
} from '../src/config/groq-models';

const USER_PROMPT = `Symbol: BTC | Timeframe: 15m | Price: 59,200
Regime: trend (bearish HTF 1h) | Grade: B | Playbook: liquidity_sweep
Last 5 candles (OHLC): 59450/59520/59380/59420, 59320/59400/59250/59350, 59200/59300/59180/59240, 59150/59250/59080/59120, 59090/59200/59050/59180
Open position: none | Pending: none
Memory: last 3 shorts stopped out in 6h — avoid revenge short unless fresh sweep.

Return JSON for btc only.`;

async function tryDispatchModel(model: string): Promise<{
  ok: boolean;
  ms: number;
  detail: string;
}> {
  const client = createGroqClient();
  if (!client) {
    return { ok: false, ms: 0, detail: 'no Groq client' };
  }

  const systemPrompt = getMethodConfig('kim_nghia').systemPrompt;
  const t0 = Date.now();
  try {
    const parsed = await client.analyze({
      systemPrompt,
      userPrompt: USER_PROMPT,
      temperature: 0.15,
      maxRetries: 0,
      preferredModels: [model],
    });
    const ms = Date.now() - t0;
    const action = String(parsed.action ?? parsed.btc?.action ?? '?');
    const conf = parsed.confidence ?? parsed.btc?.confidence;
    const entry = parsed.suggested_entry ?? parsed.btc?.suggested_entry;
    const sl = parsed.suggested_stop_loss ?? parsed.btc?.suggested_stop_loss;
    const tp = parsed.suggested_take_profit ?? parsed.btc?.suggested_take_profit;
    return {
      ok: true,
      ms,
      detail: `action=${action} conf=${conf} entry=${entry} SL=${sl} TP=${tp}`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, ms: Date.now() - t0, detail: msg.slice(0, 180) };
  }
}

async function main(): Promise<void> {
  console.log(`Env primary: ${getGroqPrimaryModel()}`);
  console.log(`Env chain: ${getGroqModelChain().join(' → ')}\n`);
  console.log('Benchmark models (dispatch analyze path):\n');

  let passed = 0;
  for (const model of GROQ_DISPATCH_BENCHMARK_MODELS) {
    const result = await tryDispatchModel(model);
    const mark = result.ok ? 'OK' : 'FAIL';
    console.log(`[${mark}] ${model} (${result.ms}ms)`);
    console.log(`       ${result.detail}\n`);
    if (result.ok) passed += 1;
  }

  console.log(`${passed}/${GROQ_DISPATCH_BENCHMARK_MODELS.length} passed dispatch benchmark`);
  if (passed === 0) process.exitCode = 1;
}

main();

/**
 * Smoke: verify Groq primary + fallback models return parseable JSON for trading-shaped prompts.
 * Usage: cd backend && npx tsx scripts/smoke-groq-models.ts
 */
import 'dotenv/config';
import { createGroqClient } from '../src/services/groq-client';
import { getGroqModelChain, getGroqPrimaryModel } from '../src/config/groq-models';

const SYSTEM = `You are a crypto futures analyst. Return JSON only for symbol btc:
{"btc":{"bias":"bullish|bearish|neutral","action":"buy|sell|hold","confidence":0-1,"suggested_entry":number,"suggested_stop_loss":number,"suggested_take_profit":number,"reason_summary":"short"}}`;

const USER = `BTC 1h: price ~64500, regime trend, grade B setup. Decide trade or hold with levels.`;

async function tryModel(model: string): Promise<{ ok: boolean; detail: string }> {
  const client = createGroqClient();
  if (!client) {
    return { ok: false, detail: 'no Groq client (missing API keys)' };
  }

  try {
    const parsed = await client.analyze({
      systemPrompt: SYSTEM,
      userPrompt: USER,
      temperature: 0.15,
      maxRetries: 0,
      preferredModels: [model],
    });
    const btc = (parsed as { btc?: Record<string, unknown> }).btc ?? parsed;
    if (!btc || typeof btc !== 'object') {
      return { ok: false, detail: 'missing btc object' };
    }
    return { ok: true, detail: `bias=${String((btc as { bias?: string }).bias)} action=${String((btc as { action?: string }).action)}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, detail: msg.slice(0, 200) };
  }
}

async function main(): Promise<void> {
  const chain = getGroqModelChain();
  console.log(`Primary: ${getGroqPrimaryModel()}`);
  console.log(`Chain: ${chain.join(' → ')}\n`);

  let passed = 0;
  for (const model of chain.slice(0, 3)) {
    const result = await tryModel(model);
    const mark = result.ok ? 'OK' : 'FAIL';
    console.log(`[${mark}] ${model}: ${result.detail}`);
    if (result.ok) passed += 1;
  }

  console.log(`\n${passed}/${Math.min(3, chain.length)} models passed JSON smoke`);
  if (passed === 0) {
    process.exitCode = 1;
  }
}

main();

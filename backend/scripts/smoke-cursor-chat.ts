/**
 * Live smoke test for Telegram /cursor cloud path.
 * Requires CURSOR_API_KEY + CURSOR_AGENT_REPO_URL in backend/.env
 *
 * Usage: npm run smoke:cursor
 * Exit 0 only when all iterations succeed.
 */
import 'dotenv/config';
import { Agent } from '@cursor/sdk';
import { buildCloudAgentOptions } from '../src/services/telegram/cursor-cloud-options';
import { buildAiContext, contextToJson } from '../src/services/telegram/ai-context.builder';
import { isCursorChatEnabled } from '../src/config/telegram-ai';

const ITERATIONS = Number(process.env.CURSOR_SMOKE_ITERATIONS || 3);
const QUESTION =
  process.env.CURSOR_SMOKE_QUESTION ||
  'Trả lời đúng 1 câu tiếng Việt: bot Kim Nghia lấy giá từ Binance Futures testnet hay spot?';

async function runOnce(iteration: number): Promise<{ ok: boolean; ms: number; answer: string }> {
  const started = Date.now();
  const opts = buildCloudAgentOptions({
    model: process.env.CURSOR_CHAT_MODEL || process.env.CURSOR_AGENT_MODEL || 'composer-2.5',
    autoCreatePR: false,
  });

  const bundle = await buildAiContext('freeform');
  const opsContext = contextToJson(bundle).slice(0, 4000);
  const prompt = [
    'You are Cursor assistant for Kim Nghia crypto bot. Answer in Vietnamese, max 3 sentences.',
    'Current bot ops snapshot:\n' + opsContext,
    QUESTION,
  ].join('\n\n');

  const agent = await Agent.create(opts);
  try {
    const run = await agent.send(prompt, { mode: 'plan' });
    const result = await run.wait();
    const ms = Date.now() - started;
    const answer = (result.result ?? '').trim();

    if (result.status !== 'finished' || !answer) {
      console.error(`[smoke ${iteration}] FAIL status=${result.status} run=${result.id} ms=${ms}`);
      return { ok: false, ms, answer: answer || `(empty, status=${result.status})` };
    }

    console.log(`[smoke ${iteration}] OK ms=${ms} answer=${answer.slice(0, 120)}...`);
    return { ok: true, ms, answer };
  } finally {
    await agent[Symbol.asyncDispose]().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  if (!isCursorChatEnabled()) {
    console.error('FAIL: Cursor chat not enabled (CURSOR_AGENT_ENABLED + CURSOR_API_KEY + CURSOR_AGENT_REPO_URL)');
    process.exit(1);
  }

  console.log(`Smoke /cursor: ${ITERATIONS} iteration(s)`);
  const results: Array<{ ok: boolean; ms: number }> = [];

  for (let i = 1; i <= ITERATIONS; i += 1) {
    const r = await runOnce(i);
    results.push(r);
    if (!r.ok) {
      console.error(`Smoke failed on iteration ${i}/${ITERATIONS}`);
      process.exit(1);
    }
    if (i < ITERATIONS) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  const avgMs = Math.round(results.reduce((s, r) => s + r.ms, 0) / results.length);
  console.log(`Smoke PASSED ${ITERATIONS}/${ITERATIONS} (avg ${avgMs}ms)`);
}

main().catch((err) => {
  console.error('Smoke FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});

/** One bounded provider-only schema smoke. No runtime, DB, scheduler or exchange imports. */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { getAiOpportunityPolicy } from '../src/config/ai-opportunity-policy';
import { requestOpportunityReview } from '../src/services/ai-opportunity-provider';
import { AI_OPPORTUNITY_PROMPT, parseOpportunityChoice } from '../src/utils/ai-opportunity';
import { opportunityFixture } from '../tests/fixtures/ai-opportunity';

async function main() {
  const f = opportunityFixture(), policy = { ...getAiOpportunityPolicy(), mode: 'shadow' as const };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), policy.timeoutMs);
  const start = Date.now();
  let report: Record<string, unknown>;
  try {
    const result = await requestOpportunityReview(AI_OPPORTUNITY_PROMPT,
      JSON.stringify({ ...f.snapshot, test: 'SYNTHETIC fixture: schema compatibility test only; no executable orders' }), policy, controller.signal);
    const choice = parseOpportunityChoice(result.content, f.snapshot);
    report = { passed: choice !== null, fixture: 'synthetic', orders_possible: false, model: result.model,
      latency_ms: Date.now() - start, input_tokens: result.inputTokens, output_tokens: result.outputTokens,
      cost_usd: result.costUsd, raw_content: result.content, choice, pnl_evidence: false };
    if (!choice) process.exitCode = 1;
  } catch {
    report = { passed: false, fixture: 'synthetic', orders_possible: false,
      latency_ms: Date.now() - start, reason: 'provider_failed_or_timed_out', pnl_evidence: false };
    process.exitCode = 1;
  } finally { clearTimeout(timer); }
  const output = JSON.stringify(report, null, 2) + '\n';
  writeFileSync('../docs/audits/2026-09-11-ai-opportunity-implementation/provider-smoke.json', output, { mode: 0o600 });
  console.log(output);
}
void main();

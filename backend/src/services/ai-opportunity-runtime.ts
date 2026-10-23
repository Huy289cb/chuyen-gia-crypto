import { createEntryTrace, withEntryTrace, currentEntryTrace, recordEntryStage } from '../utils/entry-trace';
import { recordSilentPipelineEvent } from '../repositories/testnet.repository';
import { prisma } from '../lib/prisma';
import { getAiOpportunityPolicy } from '../config/ai-opportunity-policy';
import { getBinanceMinOrderNotionalUsd } from '../config/v3-entry-policy';
import { buildOpportunitySnapshot, type OpportunityFinance, type OpportunitySnapshot } from '../utils/ai-opportunity';
import { closedCandlesOnly } from '../utils/closed-candles';
import type { MarketScanResult } from '../schedulers/market-scan.scheduler';
import { AiOpportunityReviewer } from './ai-opportunity-review.service';
import { requestOpportunityReview } from './ai-opportunity-provider';
import { claimAiOpportunity, recordAiOpportunity, claimAiOpportunityExecution } from '../repositories/ai-opportunity.repository';
import { canRunLlmDispatchForSymbol, getSymbolExposureSnapshot } from './v3-entry-eligibility.service';
import { assertTestnetAccountCanOpenTrade } from './account-risk-guard.service';
import { fetchBinanceBalanceSnapshot } from './binance-balance-sync.service';
import { normalizeQuantityForSymbol } from './binanceClient';
import { getPremiumIndex, getPrice } from './binance/market';
import { getCandles } from './candle.service';

export async function readOpportunityFinance(): Promise<OpportunityFinance> {
  const account = await prisma.testnetAccount.findUnique({ where: { symbol_method_id: { symbol: 'BTC', method_id: 'kim_nghia' } } });
  if (!account) throw new Error('account_missing');
  const eligibility = await canRunLlmDispatchForSymbol('BTC');
  const guard = await assertTestnetAccountCanOpenTrade(account.id, 'BTC');
  const [wallet, exposure, filters, premium] = await Promise.all([
    fetchBinanceBalanceSnapshot(), getSymbolExposureSnapshot('BTC'),
    normalizeQuantityForSymbol('BTCUSDT', .001), getPremiumIndex('BTCUSDT'),
  ]);
  return { balance: Math.min(wallet.walletBalance, account.current_balance),
    remainingDailyRiskUsd: guard.remainingDailyRiskUsd ?? 0,
    remainingExposureUsd: exposure.remainingUsd,
    // This new lane does not scale in or flip existing positions.
    allowed: eligibility.allowed && guard.allowed && exposure.totalUsd === 0,
    stepSize: filters.stepSize, minQty: filters.minQty,
    minNotional: getBinanceMinOrderNotionalUsd(), fundingRate: premium.lastFundingRate };
}

export async function captureOpportunitySnapshot(getScan: (tf: string) => MarketScanResult | undefined): Promise<OpportunitySnapshot | null> {
  const policy = getAiOpportunityPolicy(), asOf = Date.now();
  if (policy.mode === 'off' || !policy.pinned) return null;
  const scans = ['5m', '15m', '1h'].map(getScan);
  if (scans.some(s => !s || s.symbol !== 'BTC' || asOf - s.timestamp.getTime() > 120000 || s.timestamp.getTime() > asOf)) return null;
  const [finance, fourHour] = await Promise.all([readOpportunityFinance(), getCandles({ symbol: 'BTC', timeframe: '4h', limit: 121 })]);
  const candles: OpportunitySnapshot['candles'] = {
    '5m': closedCandlesOnly(scans[0]!.candles, '5m', asOf),
    '15m': closedCandlesOnly(scans[1]!.candles, '15m', asOf),
    '1h': closedCandlesOnly(scans[2]!.candles, '1h', asOf),
    '4h': closedCandlesOnly(fourHour.candles, '4h', asOf).slice(-120),
  };
  const diagnostics: Record<string, number> = {};
  const snapshot = buildOpportunitySnapshot({ asOf, candles, finance, policy, diagnostics });
  await recordSilentPipelineEvent('opportunity_feasibility', { as_of: asOf, policy_hash: policy.hash,
    counts: diagnostics, eligible_plans: snapshot?.plans.length ?? 0 });
  return snapshot;
}

let scanGetter: (tf: string) => MarketScanResult | undefined = () => undefined;
const reviewer = new AiOpportunityReviewer({
  now: Date.now, policy: getAiOpportunityPolicy,
  snapshot: () => captureOpportunitySnapshot(scanGetter),
  claim: claimAiOpportunity, provider: requestOpportunityReview, record: recordAiOpportunity,
  current: async () => { const [finance, price] = await Promise.all([readOpportunityFinance(), getPrice('BTCUSDT')]); return { finance, price }; },
  claimExecution: claimAiOpportunityExecution,
  livePolicyHash: () => process.env.AI_OPPORTUNITY_LIVE_POLICY_HASH,
  execute: async (plan, snapshot, reviewId) => {
    const { executeV3Trade } = await import('./v3-trade-execution.service');
    const decision = await prisma.tradeDecision.create({ data: {
      symbol: 'BTC', timeframe: '15m', playbook_key: plan.setup, grade: 'B', confidence: 0,
      regime: 'ai_opportunity', decision: 'trade', reason: `Validated plan selection; review=${reviewId}; confidence not calibrated`,
      entry_price: plan.entry, stop_loss: plan.stopLoss, take_profit: plan.takeProfit, expected_rr: plan.rr,
      candle_hash: `ai-opportunity:${reviewId}`, method_id: 'kim_nghia',
    } });
    if (currentEntryTrace()) {
      currentEntryTrace()!.decision_id = decision.id;
      currentEntryTrace()!.candidate_key = plan.id;
    }
    await recordEntryStage('decision', { decision_id: decision.id, review_id: reviewId, plan_id: plan.id });
    const result = await executeV3Trade({ symbol: 'BTC', timeframe: '15m', methodId: 'kim_nghia',
      requiredMinRr: getAiOpportunityPolicy().minRr, decisionRecordId: decision.id,
      analysis: { action: plan.side === 'long' ? 'buy' : 'sell', bias: plan.side === 'long' ? 'bullish' : 'bearish',
        confidence: 0, suggested_entry: plan.entry, suggested_stop_loss: plan.stopLoss,
        suggested_take_profit: plan.takeProfit, expected_rr: plan.rr, invalidation_level: plan.invalidation },
      opportunityContract: { plan, policyHash: snapshot.policyHash, snapshotAt: snapshot.asOf },
    });
    if (!result.success) await prisma.tradeDecision.update({ where: { id: decision.id },
      data: { decision: 'no_trade', reason: `AI opportunity execution blocked: ${result.reason}` } });
    return result;
  },
});

export async function runAiOpportunityReview(getScan: (tf: string) => MarketScanResult | undefined) {
  scanGetter = getScan;
  return withEntryTrace(createEntryTrace({ lane: 'ai_opportunity' }, getAiOpportunityPolicy()), () => reviewer.run());
}

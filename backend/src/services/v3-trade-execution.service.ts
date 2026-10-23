import {causalPlanBlock,causalAnalysisBlock,type CausalPlanContract} from '../utils/causal-plan-contract';
import {evaluateEntryPriceLevels,evaluateEntryStopFloor} from '../utils/entry-price-feasibility';
import {encodeMaterializationNumber} from '../utils/recorded-materialization-gate';
import { computeTargetRiskSizing } from '../utils/target-risk-sizing';
import { randomUUID } from 'node:crypto';
import { publishExposureObservation } from '../utils/exposure-observation-publish';
import { evaluateEntryOccupancy } from '../utils/entry-occupancy-evaluation';
import {observePendingCreation} from '../utils/pending-create-observation';
import { encodePostQuantityInput } from '../utils/recorded-post-quantity';
import { evaluatePostQuantityAdmission } from '../utils/post-quantity-admission';
import { createEntryTrace, currentEntryTrace, withEntryTrace, recordEntryStage, type EntryTrace } from '../utils/entry-trace';
/**
 * V3 trade execution — places Binance testnet limit orders and records pending orders.
 * Position is created only after WebSocket fill (binance-websocket-sync).
 */

import type { GroqAnalysis } from './groq-client';
import { getMethodConfig } from '../config/methods';
import { getRiskPolicy } from '../config/risk-policy';
import {
  isV3OppositeFlipEnabled,
  isV3ScaleInEnabled,
  getBinanceMinOrderNotionalUsd,
  resolveTargetPositionNotionalUsd,
  getNotionalTolerancePercent,
  minNotionalWithTolerance,
} from '../config/v3-entry-policy';
import { assertTestnetAccountCanOpenTrade } from './account-risk-guard.service';
import { checkBinanceAccountTradable } from './binance-account-health.service';
import { tryOppositeFlipBeforeEntry } from './opposite-flip.service';
import {
  assertScaleInSideAllowed,
  assertSameSidePostCloseCooldown,
  getSymbolExposureSnapshot,
} from './v3-entry-eligibility.service';
import {
  createTestnetPendingOrder,
  getActiveTestnetPositions,
  getBlockingTestnetPendingOrders,
  getOrCreateTestnetAccount,
} from '../repositories/testnet.repository';
import { ensurePositionModeDetected } from './binance-hedge-mode';
import { resolveQuantityForMinNotional } from '../utils/order-quantity';
import { computeExpectedRrFromPrices } from '../utils/trade-levels';
import { computeExecutionRisk, resolveExecutionRiskCapUsd } from '../utils/execution-risk';
import { initTestnetClient, normalizeQuantityForSymbol, placeLimitOrder } from './binanceClient';
import { hookPendingOrderPlaced } from './telegram/telegram-hooks';
import { getAiOpportunityPolicy } from '../config/ai-opportunity-policy';
import type { OpportunityPlan } from '../utils/ai-opportunity';

export interface V3TradeExecutionInput {
  causalPlan?: CausalPlanContract;
  trace?: EntryTrace;
  symbol: string;
  timeframe: string;
  analysis: GroqAnalysis;
  methodId?: string;
  /** trade_decisions.id from LLM dispatch — links outcome on close */
  decisionRecordId?: number;
  /** Setup-specific minimum R:R (for example range retest uses 1.5 instead of method default). */
  requiredMinRr?: number;
  /** Sealed plan selected by the new lane; executor never increases its approved quantity. */
  opportunityContract?: { plan: OpportunityPlan; policyHash: string; snapshotAt: number };
}

export interface MinimumLotLevelAdjustment {
  originalStopLoss: number;
  originalTakeProfit: number;
  stopLoss: number;
  takeProfit: number;
  originalStopPercent: number;
  normalizedStopPercent: number;
  effectiveRiskPercent: number;
}

export interface V3TradeExecutionResult {
  rejectionCode?: string;
  success: boolean;
  orderId?: string;
  binanceOrderId?: string;
  reason: string;
  levelAdjustment?: MinimumLotLevelAdjustment;
}

function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeSide(action: string): 'long' | 'short' | null {
  const a = action.toLowerCase();
  if (a === 'buy' || a === 'long') return 'long';
  if (a === 'sell' || a === 'short') return 'short';
  return null;
}

/**
 * Execute an LLM-approved trade on Binance testnet (limit entry + pending order row).
 */
export async function executeV3Trade(input: V3TradeExecutionInput): Promise<V3TradeExecutionResult> {
  if(input.causalPlan) input={...input,causalPlan:JSON.parse(JSON.stringify(input.causalPlan)),analysis:JSON.parse(JSON.stringify(input.analysis))};
  const trace = input.trace ?? currentEntryTrace() ?? createEntryTrace({
    lane: input.causalPlan ? 'causal_execution' : input.opportunityContract ? 'ai_opportunity' : 'direct_execution', decision_id: input.decisionRecordId,
    candidate_key: input.causalPlan?.setupId ?? input.opportunityContract?.plan.id,
  }, getRiskPolicy());
  return withEntryTrace(trace, async () => {
    await recordEntryStage('admission_started');
    try {
      const result = await executeV3TradeTraced(input);
      await recordEntryStage(result.success ? 'order_pending' : 'admission_rejected', {
        rejection_code: result.rejectionCode ?? (result.success ? null : 'other_guard'),
        reason: result.reason, order_id: result.orderId, binance_order_id: result.binanceOrderId });
      return result;
    } catch (error) { await recordEntryStage('execution_error'); throw error; }
  });
}
async function executeV3TradeTraced(input: V3TradeExecutionInput): Promise<V3TradeExecutionResult> {
  const {
    symbol,
    timeframe,
    analysis,
    methodId = 'kim_nghia',
    decisionRecordId,
    requiredMinRr,
  } = input;

  if (process.env.BINANCE_ENABLED !== 'true') {
    const reason = 'BINANCE_ENABLED is not true — cannot place live testnet order';
    return { success: false, reason };
  }

  const side = normalizeSide(String(analysis.action || ''));
  if (!side) {
    return { success: false, reason: `Invalid action for trade: ${analysis.action}` };
  }

  const contractBlock = () => {
    if(input.causalPlan) {
      const block=causalPlanBlock(input.causalPlan,symbol,timeframe,Date.now()) ?? causalAnalysisBlock(input.causalPlan,analysis);
      if(block) return block;
      if(input.opportunityContract || requiredMinRr!==input.causalPlan.minRr) return 'causal_plan_execution_contract_conflict';
    }
    const contract = input.opportunityContract;
    if (!contract) return null;
    const policy = getAiOpportunityPolicy(), plan = contract.plan;
    if (policy.mode !== 'live' || !policy.pinned || policy.hash !== contract.policyHash ||
      process.env.AI_OPPORTUNITY_LIVE_POLICY_HASH !== policy.hash) return 'AI opportunity live policy disabled or changed';
    if (!Number.isFinite(contract.snapshotAt) || contract.snapshotAt > Date.now() ||
      Date.now() - contract.snapshotAt > policy.maxSnapshotAgeMs || !Number.isFinite(plan.expiresAt) ||
      Date.now() >= plan.expiresAt) return 'AI opportunity plan expired';
    if (symbol !== 'BTC' || timeframe !== '15m' || plan.symbol !== symbol || plan.side !== side ||
      analysis.suggested_entry !== plan.entry || analysis.suggested_stop_loss !== plan.stopLoss ||
      analysis.suggested_take_profit !== plan.takeProfit || analysis.invalidation_level !== plan.invalidation ||
      requiredMinRr !== 3 || !Number.isFinite(plan.quantity) || plan.quantity <= 0) return 'AI opportunity plan changed';
    const direction = side === 'long' ? 1 : -1;
    if (!Number.isFinite(plan.targetBound) || direction * (plan.takeProfit - plan.targetBound) > 1e-9) return 'AI opportunity target exceeds structure';
    return null;
  };
  const earlyContractBlock = contractBlock();
  if (earlyContractBlock) return { success: false, reason: earlyContractBlock };

  const feasibility_attempt_id = randomUUID();
  const entry = Number(analysis.suggested_entry);
  const stopLoss = Number(analysis.suggested_stop_loss);
  const takeProfit = Number(analysis.suggested_take_profit);
  const priceBlock = evaluateEntryPriceLevels(side,entry,stopLoss,takeProfit);
  publishExposureObservation({schema:'entry-price-feasibility-v1',stage:'price_levels',feasibility_attempt_id,symbol,method_id:methodId,side,
    observed_at:new Date().toISOString(),entry:encodeMaterializationNumber(entry),stop_loss:encodeMaterializationNumber(stopLoss),
    take_profit:encodeMaterializationNumber(takeProfit),decision:priceBlock},data=>recordEntryStage('entry_price_feasibility_evaluated',{feasibility:data}));
  if(priceBlock) return priceBlock;

  const auto = getMethodConfig(methodId).autoEntry;
  const riskPolicy = getRiskPolicy();
  const minSlDistancePercent =
    riskPolicy.minSlDistancePercent > 0
      ? riskPolicy.minSlDistancePercent
      : auto.minSLDistancePercent;

  const floorResult = evaluateEntryStopFloor(entry,stopLoss,minSlDistancePercent);
  publishExposureObservation({schema:'entry-price-feasibility-v1',stage:'stop_floor',feasibility_attempt_id,symbol,method_id:methodId,side,
    observed_at:new Date().toISOString(),entry:encodeMaterializationNumber(entry),stop_loss:encodeMaterializationNumber(stopLoss),
    min_distance_percent:encodeMaterializationNumber(minSlDistancePercent),decision:floorResult},
    data=>recordEntryStage('entry_price_feasibility_evaluated',{feasibility:data}));
  if(floorResult.block) return floorResult.block;
  const slCheck = floorResult.check;
  const slDistancePct = slCheck.distancePct;

  const account = await getOrCreateTestnetAccount(symbol, methodId, 10000);

  const accountGuard = await assertTestnetAccountCanOpenTrade(account.id, symbol);
  if (!accountGuard.allowed) {
    return { success: false, reason: accountGuard.reason };
  }

  const binanceHealth = await checkBinanceAccountTradable();
  if (!binanceHealth.tradable) {
    return { success: false, reason: binanceHealth.reason };
  }

  const balance = Number(account.current_balance ?? account.equity ?? 10000);

  if (!input.opportunityContract && isV3OppositeFlipEnabled()) {
    const flip = await tryOppositeFlipBeforeEntry({
      symbol,
      methodId,
      newSide: side,
      analysis,
      timeframe,
    });
    if (flip.reason !== 'no opposite exposure' && !flip.flipped) {
      return { success: false, reason: flip.reason };
    }
  }

  const sideBlockReason = await assertScaleInSideAllowed(symbol, side);
  if (sideBlockReason) {
    return { success: false, reason: sideBlockReason };
  }

  const chaseBlock = await assertSameSidePostCloseCooldown(symbol, side, methodId);
  if (chaseBlock) {
    return { success: false, reason: chaseBlock };
  }

  const occupancy_read_started_at = new Date().toISOString();
  const [openPositions, pendingOrders] = await Promise.all([
    getActiveTestnetPositions({ symbol, methodId }),
    getBlockingTestnetPendingOrders({ symbol, methodId }),
  ]);

  const occupancy_read_returned_at = new Date().toISOString();
  let scale_in_enabled:boolean|null=null, flip_enabled:boolean|null=null;
  const occupancyBlock = evaluateEntryOccupancy({opportunityContract:!!input.opportunityContract,side,openPositions,pendingOrders,
    maxPositionsPerSymbol:riskPolicy.maxPositionsPerSymbol,scaleInEnabled:()=>{scale_in_enabled=isV3ScaleInEnabled();return scale_in_enabled;},
    flipEnabled:()=>{flip_enabled=isV3OppositeFlipEnabled();return flip_enabled;}});
  publishExposureObservation({input:{schema:'entry-occupancy-read-v1',read_id:randomUUID(),symbol,method_id:methodId,side,
    opportunity_contract:!!input.opportunityContract,max_positions_per_symbol:riskPolicy.maxPositionsPerSymbol,scale_in_enabled,flip_enabled,
    read_started_at:occupancy_read_started_at,read_returned_at:occupancy_read_returned_at,observed_at:new Date().toISOString(),
    open_positions:openPositions.map(p=>({position_id:p.position_id,side:p.side,status:p.status})),
    pending_orders:pendingOrders.map(o=>({order_id:o.order_id,side:o.side,status:o.status})),
    read_atomicity:'parallel_repository_reads_not_joint_snapshot'},decision:occupancyBlock},
    data=>recordEntryStage('entry_occupancy_evaluated',data));
  if (occupancyBlock) return occupancyBlock;

  const exposure = await getSymbolExposureSnapshot(symbol, methodId);
  const totalExposure = exposure.totalUsd;
  const maxExposure = exposure.maxExposureUsd;

  if (totalExposure >= maxExposure) {
    return {
      success: false,
      rejectionCode: 'exposure',
      reason: `Max exposure reached (${totalExposure.toFixed(0)}/${maxExposure} USD open+pending)`,
    };
  }

  const remainingCapacity = exposure.remainingUsd;
  const minNotional = getBinanceMinOrderNotionalUsd();
  const notionalTolerance = getNotionalTolerancePercent();
  const {targetRiskUsd,computedSizeUsd} = computeTargetRiskSizing(balance,riskPolicy.riskPerTradePercent,slDistancePct);
  const sizeUsd = resolveTargetPositionNotionalUsd({
    computedUsd: computedSizeUsd,
    minNotionalUsd: minNotional,
    remainingCapacityUsd: remainingCapacity,
  });
  if (sizeUsd <= 0) {
    return { success: false, rejectionCode: 'min_notional', reason: 'Computed position size <= 0' };
  }
  const minNotionalFloor = minNotionalWithTolerance(minNotional, notionalTolerance);
  if (sizeUsd < minNotionalFloor) {
    const headroomMsg =
      exposure.openUsd > 0
        ? `Scale-in headroom $${remainingCapacity.toFixed(0)} below Binance min order $${minNotional}`
        : `Order notional $${sizeUsd.toFixed(0)} well below Binance minimum $${minNotional}`;
    return { success: false, rejectionCode: remainingCapacity < minNotionalFloor ? 'exposure' : 'min_notional', reason: headroomMsg };
  }

  const sizeQty = sizeUsd / entry;
  const symbolUsdt = `${symbol.toUpperCase()}USDT`;

  const qtyCheck = await normalizeQuantityForSymbol(symbolUsdt, sizeQty);
  const qtyResolved = resolveQuantityForMinNotional({
    quantity: sizeQty,
    entryPrice: entry,
    minNotionalUsd: minNotional,
    stepSize: qtyCheck.stepSize,
    minQty: qtyCheck.minQty,
    maxNotionalUsd: remainingCapacity,
    tolerancePercent: notionalTolerance,
  });
  await recordEntryStage('quantity_checked', { admission_schema: 'financial-inputs-v1',
    side, entry, stop_loss: stopLoss, take_profit: takeProfit, account_balance: balance,
    target_risk_percent: riskPolicy.riskPerTradePercent, target_risk_usd: targetRiskUsd,
    computed_size_usd: computedSizeUsd, selected_notional_usd: sizeUsd,
    notional_tolerance_percent: notionalTolerance, effective_min_notional: minNotionalFloor,
    raw_quantity: sizeQty, normalized_quantity: qtyResolved.normalizedQty,
    min_qty: qtyCheck.minQty, step_size: qtyCheck.stepSize, min_notional: minNotional,
    remaining_exposure_usd: remainingCapacity, order_notional: qtyResolved.orderNotional,
    raised_to_minimum: qtyResolved.normalizedQty > sizeQty, rejection_code: qtyResolved.code ?? null });
  if (!qtyResolved.valid) {
    return {
      success: false,
      rejectionCode: qtyResolved.code ?? 'quantity_unknown',
      reason: qtyResolved.reason ?? 'Order quantity invalid after exchange normalization',
    };
  }
  const normalizedSizeQty = qtyResolved.normalizedQty;
  const orderNotional = qtyResolved.orderNotional;
  const effectiveSizeUsd = orderNotional;
  // Preserve the strategy's invalidation and target. Wallet size is never a reason
  // to tighten a structural stop or manufacture a more distant target.
  const risk = computeExecutionRisk({ entry, stopLoss, quantity: normalizedSizeQty, balance,
    roundTripFeePercent: Math.max(0.1, riskPolicy.maxFeePercent),
    slippagePercent: Math.max(0.1, riskPolicy.maxSlippagePercent) });
  const effectiveRiskUsd = risk.totalRiskUsd;
  const effectiveRiskPercent = risk.riskPercent;
  const levelAdjustment: MinimumLotLevelAdjustment | undefined = undefined;

  const effectiveRiskCapUsd = resolveExecutionRiskCapUsd({ balance,
    maxRiskPercent: riskPolicy.maxEffectiveRiskPerTradePercent, maxRiskUsd: riskPolicy.maxEffectiveRiskPerTradeUsd });
  await recordEntryStage('risk_checked', { admission_schema: 'financial-inputs-v1',
    side, entry, stop_loss: stopLoss, take_profit: takeProfit, account_balance: balance,
    normalized_quantity: normalizedSizeQty,
    admission_fee_percent: Math.max(0.1, riskPolicy.maxFeePercent),
    admission_slippage_percent: Math.max(0.1, riskPolicy.maxSlippagePercent),
    max_risk_percent: riskPolicy.maxEffectiveRiskPerTradePercent,
    max_risk_usd: riskPolicy.maxEffectiveRiskPerTradeUsd,
    ...risk, cap_usd: effectiveRiskCapUsd,
    remaining_daily_risk_usd: accountGuard.remainingDailyRiskUsd ?? null });
  const expectedRr = computeExpectedRrFromPrices(entry, stopLoss, takeProfit) ?? Number(analysis.expected_rr) ?? 0;
  const minRr = requiredMinRr ?? auto.minRRRatio;
  const admissionInput = {side,entry,stopLoss,
    effectiveRiskUsd,effectiveRiskPercent,effectiveRiskCapUsd,expectedRr,minRr,
    invalidation:Number(analysis.invalidation_level),dailyEnabled:riskPolicy.circuitDailyLossEnabled,
    remainingDailyRiskUsd:accountGuard.remainingDailyRiskUsd};
  const admission = evaluatePostQuantityAdmission(admissionInput);
  await recordEntryStage('post_quantity_evaluated', {input:encodePostQuantityInput(admissionInput),decision:admission});
  if (!admission.allowed) {
    const rejection = {reason:admission.reason, ...(admission.rejectionCode ? {rejectionCode:admission.rejectionCode} : {})};
    return {success:false,...rejection};
  }

  const orderId = `v3_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const newClientOrderId = `x-${orderId}`;

  const client = initTestnetClient();
  if (!client) {
    return { success: false, reason: 'Binance client unavailable' };
  }

  await ensurePositionModeDetected();

  const lateContractBlock = contractBlock();
  if (lateContractBlock) return { success: false, reason: lateContractBlock };
  if (input.opportunityContract && normalizedSizeQty > input.opportunityContract.plan.quantity + 1e-9) {
    return { success: false, reason: 'AI opportunity quantity exceeds reviewed plan' };
  }

  const binanceSide = side === 'long' ? 'BUY' : 'SELL';
  let binanceOrderId: string;

  await recordEntryStage('order_submitting', { order_id: orderId, client_order_id: newClientOrderId });
  try {
    const order = await placeLimitOrder(
      client,
      symbolUsdt,
      binanceSide,
      normalizedSizeQty,
      entry,
      'OPEN',
      null,
      null,
      newClientOrderId
    );
    binanceOrderId = String(order.orderId);
    console.log(
      `[V3TradeExecution] Binance limit order ${binanceOrderId} (${newClientOrderId}) ` +
        `${symbol} ${timeframe} ${side} entry=${entry} sizeUsd=${effectiveSizeUsd.toFixed(2)} ` +
        `riskUsd=${effectiveRiskUsd.toFixed(4)} riskPct=${effectiveRiskPercent.toFixed(2)}`
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[V3TradeExecution] Binance order failed: ${message}`);
    return { success: false, rejectionCode: 'exchange_submission_unknown', reason: `Binance order placement failed: ${message}` };
  }

  const pendingCreateInput = {
    orderId,
    accountId: account.id,
    symbol: symbol.toUpperCase(),
    side,
    entryPrice: entry,
    stopLoss,
    takeProfit,
    sizeUsd: effectiveSizeUsd,
    sizeQty: normalizedSizeQty,
    riskUsd: effectiveRiskUsd,
    riskPercent: effectiveRiskPercent,
    expectedRr,
    invalidationLevel: isValidNumber(analysis.invalidation_level)
      ? analysis.invalidation_level
      : undefined,
    methodId,
    binanceOrderId,
  };
  await observePendingCreation(pendingCreateInput, () => createTestnetPendingOrder(pendingCreateInput),
    data => recordEntryStage('pending_create_write_observed', data));

  hookPendingOrderPlaced({
    symbol: symbol.toUpperCase(),
    side,
    timeframe,
    entry,
    stopLoss,
    takeProfit,
    sizeQty: normalizedSizeQty,
    sizeUsd: effectiveSizeUsd,
    accountBalance: balance,
    orderId,
    binanceOrderId,
  });

  {
    const { recordPipelineEvent } = await import('../repositories/testnet.repository');
    await recordPipelineEvent('pending_order_linked', {
      order_id: orderId,
      binance_order_id: binanceOrderId,
      decision_id: decisionRecordId,
      symbol: symbol.toUpperCase(),
      timeframe,
      execution_risk: risk,
    });
  }

  return {
    success: true,
    orderId,
    binanceOrderId,
    reason: levelAdjustment
      ? `Pending limit order created (${timeframe}); minimum-lot stop normalized`
      : `Pending limit order created (${timeframe})`,
    levelAdjustment,
  };
}

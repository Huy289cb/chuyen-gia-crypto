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
} from '../config/v3-entry-policy';
import { assertTestnetAccountCanOpenTrade } from './account-risk-guard.service';
import { checkBinanceAccountTradable } from './binance-account-health.service';
import { tryOppositeFlipBeforeEntry } from './opposite-flip.service';
import {
  assertScaleInSideAllowed,
  getSymbolExposureSnapshot,
  oppositeLocalSide,
} from './v3-entry-eligibility.service';
import {
  createTestnetPendingOrder,
  getActiveTestnetPositions,
  getBlockingTestnetPendingOrders,
  getOrCreateTestnetAccount,
} from '../repositories/testnet.repository';
import { ensurePositionModeDetected } from './binance-hedge-mode';
import { checkMinSlDistance, computeExpectedRrFromPrices } from '../utils/trade-levels';
import { initTestnetClient, normalizeQuantityForSymbol, placeLimitOrder } from './binanceClient';
import { hookPendingOrderPlaced } from './telegram/telegram-hooks';

export interface V3TradeExecutionInput {
  symbol: string;
  timeframe: string;
  analysis: GroqAnalysis;
  methodId?: string;
  /** trade_decisions.id from LLM dispatch — links outcome on close */
  decisionRecordId?: number;
}

export interface V3TradeExecutionResult {
  success: boolean;
  orderId?: string;
  binanceOrderId?: string;
  reason: string;
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

function validatePriceLevels(
  side: 'long' | 'short',
  entry: number,
  stopLoss: number,
  takeProfit: number
): string | null {
  if (side === 'long') {
    if (stopLoss >= entry) return 'LONG requires stop_loss < entry';
    if (takeProfit <= entry) return 'LONG requires take_profit > entry';
  } else {
    if (stopLoss <= entry) return 'SHORT requires stop_loss > entry';
    if (takeProfit >= entry) return 'SHORT requires take_profit < entry';
  }
  return null;
}

/**
 * Execute an LLM-approved trade on Binance testnet (limit entry + pending order row).
 */
export async function executeV3Trade(
  input: V3TradeExecutionInput
): Promise<V3TradeExecutionResult> {
  const { symbol, timeframe, analysis, methodId = 'kim_nghia', decisionRecordId } = input;

  if (process.env.BINANCE_ENABLED !== 'true') {
    const reason = 'BINANCE_ENABLED is not true — cannot place live testnet order';
    return { success: false, reason };
  }

  const side = normalizeSide(String(analysis.action || ''));
  if (!side) {
    return { success: false, reason: `Invalid action for trade: ${analysis.action}` };
  }

  const entry = Number(analysis.suggested_entry);
  const stopLoss = Number(analysis.suggested_stop_loss);
  const takeProfit = Number(analysis.suggested_take_profit);
  if (!isValidNumber(entry) || !isValidNumber(stopLoss) || !isValidNumber(takeProfit)) {
    return { success: false, reason: 'Missing or invalid entry / stop_loss / take_profit' };
  }

  const levelError = validatePriceLevels(side, entry, stopLoss, takeProfit);
  if (levelError) {
    return { success: false, reason: levelError };
  }

  const auto = getMethodConfig(methodId).autoEntry;
  const riskPolicy = getRiskPolicy();
  const minSlDistancePercent =
    riskPolicy.minSlDistancePercent > 0
      ? riskPolicy.minSlDistancePercent
      : auto.minSLDistancePercent;

  const slCheck = checkMinSlDistance(entry, stopLoss, minSlDistancePercent);
  if (!slCheck.ok) {
    return {
      success: false,
      reason: `SL distance ${(slCheck.distancePct * 100).toFixed(2)}% below min ${(slCheck.minPct * 100).toFixed(2)}%`,
    };
  }
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

  if (isV3OppositeFlipEnabled()) {
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

  const [openPositions, pendingOrders] = await Promise.all([
    getActiveTestnetPositions({ symbol, methodId }),
    getBlockingTestnetPendingOrders({ symbol, methodId }),
  ]);

  const scaleIn = isV3ScaleInEnabled();
  const opposite = oppositeLocalSide(side);

  if (scaleIn) {
    const oppositeOpen = openPositions.filter(
      (p) => String(p.side).toLowerCase() === opposite
    );
    if (oppositeOpen.length > 0 && !isV3OppositeFlipEnabled()) {
      return {
        success: false,
        reason: `Opposite ${opposite} position open — cannot open ${side}`,
      };
    }

    const oppositePending = pendingOrders.filter(
      (o) => String(o.side).toLowerCase() === opposite
    );
    if (oppositePending.length > 0) {
      return {
        success: false,
        reason: `Opposite ${opposite} pending order exists`,
      };
    }

    const unresolved = pendingOrders.filter(
      (o) => o.status === 'reconciliation_failed_not_on_binance'
    );
    if (unresolved.length > 0) {
      const blocking = unresolved[0];
      return {
        success: false,
        reason: `Unresolved ${side} pending order ${blocking.order_id} (reconcile pending — Binance state unknown)`,
      };
    }
  } else {
    const sameSideOpen = openPositions.filter(
      (p) => String(p.side).toLowerCase() === side
    );
    if (sameSideOpen.length > 0) {
      return {
        success: false,
        reason: `Same-side ${side} position already open (scaling-in disabled)`,
      };
    }

    const sameSidePending = pendingOrders.filter(
      (o) => String(o.side).toLowerCase() === side
    );
    if (sameSidePending.length > 0) {
      const blocking = sameSidePending[0];
      const status = String(blocking.status ?? 'pending');
      return {
        success: false,
        reason:
          status === 'reconciliation_failed_not_on_binance'
            ? `Unresolved ${side} pending order ${blocking.order_id} (reconcile pending — Binance state unknown)`
            : `Same-side ${side} pending order already exists`,
      };
    }

    const maxPerSymbol = riskPolicy.maxPositionsPerSymbol;
    if (openPositions.length >= maxPerSymbol || pendingOrders.length >= maxPerSymbol) {
      return {
        success: false,
        reason: `Max positions/orders per symbol (${maxPerSymbol}) reached`,
      };
    }
  }

  const exposure = await getSymbolExposureSnapshot(symbol, methodId);
  const totalExposure = exposure.totalUsd;
  const maxExposure = exposure.maxExposureUsd;

  if (totalExposure >= maxExposure) {
    return {
      success: false,
      reason: `Max exposure reached (${totalExposure.toFixed(0)}/${maxExposure} USD open+pending)`,
    };
  }

  const remainingCapacity = exposure.remainingUsd;
  const minNotional = getBinanceMinOrderNotionalUsd();
  const riskUsd = Math.max(1, balance * (riskPolicy.riskPerTradePercent / 100));
  const computedSizeUsd = riskUsd / slDistancePct;
  const sizeUsd = resolveTargetPositionNotionalUsd({
    computedUsd: computedSizeUsd,
    minNotionalUsd: minNotional,
    remainingCapacityUsd: remainingCapacity,
  });
  if (sizeUsd <= 0) {
    return { success: false, reason: 'Computed position size <= 0' };
  }
  if (sizeUsd < minNotional) {
    const headroomMsg =
      exposure.openUsd > 0
        ? `Scale-in headroom $${remainingCapacity.toFixed(0)} below Binance min order $${minNotional}`
        : `Order notional $${sizeUsd.toFixed(0)} below Binance minimum $${minNotional}`;
    return { success: false, reason: headroomMsg };
  }

  const sizeQty = sizeUsd / entry;
  const symbolUsdt = `${symbol.toUpperCase()}USDT`;

  const qtyCheck = await normalizeQuantityForSymbol(symbolUsdt, sizeQty);
  if (!qtyCheck.valid) {
    return {
      success: false,
      reason: qtyCheck.reason ?? 'Order quantity invalid after exchange normalization',
    };
  }
  const normalizedSizeQty = qtyCheck.normalizedQty;
  if (normalizedSizeQty <= 0) {
    return { success: false, reason: 'Normalized quantity is zero — order blocked' };
  }
  const orderNotional = normalizedSizeQty * entry;
  if (orderNotional < minNotional) {
    return {
      success: false,
      reason: `Order notional $${orderNotional.toFixed(0)} below Binance minimum $${minNotional} after qty normalization`,
    };
  }

  const expectedRr =
    computeExpectedRrFromPrices(entry, stopLoss, takeProfit) ??
    Number(analysis.expected_rr) ??
    0;

  const orderId = `v3_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const newClientOrderId = `x-${orderId}`;

  const client = initTestnetClient();
  if (!client) {
    return { success: false, reason: 'Binance client unavailable' };
  }

  await ensurePositionModeDetected();

  const binanceSide = side === 'long' ? 'BUY' : 'SELL';
  let binanceOrderId: string;

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
        `${symbol} ${timeframe} ${side} entry=${entry} sizeUsd=${sizeUsd.toFixed(2)}`
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[V3TradeExecution] Binance order failed: ${message}`);
    return { success: false, reason: `Binance order placement failed: ${message}` };
  }

  await createTestnetPendingOrder({
    orderId,
    accountId: account.id,
    symbol: symbol.toUpperCase(),
    side,
    entryPrice: entry,
    stopLoss,
    takeProfit,
    sizeUsd,
    sizeQty: normalizedSizeQty,
    riskUsd,
    riskPercent: riskPolicy.riskPerTradePercent,
    expectedRr,
    invalidationLevel: isValidNumber(analysis.invalidation_level)
      ? analysis.invalidation_level
      : undefined,
    methodId,
    binanceOrderId,
  });

  hookPendingOrderPlaced({
    symbol: symbol.toUpperCase(),
    side,
    timeframe,
    entry,
    stopLoss,
    takeProfit,
    sizeQty: normalizedSizeQty,
    sizeUsd,
    accountBalance: balance,
    orderId,
    binanceOrderId,
  });

  if (decisionRecordId) {
    const { recordPipelineEvent } = await import('../repositories/testnet.repository');
    await recordPipelineEvent('pending_order_linked', {
      order_id: orderId,
      binance_order_id: binanceOrderId,
      decision_id: decisionRecordId,
      symbol: symbol.toUpperCase(),
      timeframe,
    });
  }

  return {
    success: true,
    orderId,
    binanceOrderId,
    reason: `Pending limit order created (${timeframe})`,
  };
}

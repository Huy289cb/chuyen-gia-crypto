import { Decimal } from '@prisma/client/runtime/library';
import type { LivePortfolioWallet } from './live-service';

const terminal = ['FILLED', 'CANCELED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'EXPIRED_IN_MATCH'];
const amount = (value: string): Decimal => {
  const parsed = new Decimal(value); if (!parsed.isFinite()) throw new Error('Invalid notification financial context'); return parsed;
};
const readPaths = new Set(['/fapi/v3/account', '/fapi/v3/positionRisk', '/fapi/v1/openOrders',
  '/fapi/v1/openAlgoOrders', '/fapi/v1/userTrades', '/fapi/v1/income', '/fapi/v1/exchangeInfo',
  '/fapi/v1/premiumIndex', '/fapi/v2/ticker/price', '/fapi/v1/commissionRate',
  '/fapi/v1/symbolConfig', '/fapi/v1/positionSide/dual', '/fapi/v1/leverageBracket']);
const critical = (reason: string): boolean => /unknown|ambiguous|unowned|mismatch|invalid|nonfinite|unsupported|unapproved|missing.*(?:anchor|boundary)|(?:anchor|boundary).*missing|daily.*(?:loss|budget)|unresolved_or_partial_order|(?:ledger|intent).*reconciliation|income coverage|unexplained|\b(?:POST|DELETE)\b|Authenticated background intents unavailable/i.test(reason);

function knownDelay(reason: string, allowAuxiliary: boolean): boolean {
  if (critical(reason)) return false;
  // Never let the generic timeout matcher hide a mutation, an order query,
  // a Binance error code or malformed authenticated data.
  if (reason.startsWith('Binance portfolio ')) {
    const match = /^Binance portfolio GET (\/fapi\/[^\s]+) failed \(request_failed\)\.$/.exec(reason);
    return Boolean(match && readPaths.has(match[1]!));
  }
  const support = reason.replace(/^Authenticated history unavailable; conservative risk only: /, '').split('; ');
  if (support.every(part => /^Authenticated background (?:metadata|orders|history) unavailable$/.test(part))) {
    // The fetcher intentionally omits the underlying cause. Delay its notice
    // only while the authenticated wallet has no financial uncertainty.
    return allowAuxiliary;
  }
  if (/^Live public (?:book|mark) quote unavailable for (?:BTC|ETH|BNB|SOL|XRP)USDT \((?:missing|stale|disconnected)\)\.$/.test(reason)) return true;
  if (reason.startsWith('Live public ')) return false;
  // A code or a malformed background result must not fall through to the
  // generic network matcher, even if another lane also says unavailable.
  if (/^Authenticated (?:background|history unavailable)/.test(reason)) return false;
  return /stale|timed? ?out|network|connect|fetch|econn|socket|source preparation|background support|support.*(?:pending|incomplete)/i.test(reason);
}

/** This controls notification timing only; it never grants permission to trade. */
export function isDeferrableLiveNotificationError(reason: string, wallet?: LivePortfolioWallet): boolean {
  if (wallet) {
    try {
      if (wallet.equityQuality !== 'reconciled' || !amount(wallet.unreconciledWalletDelta).isZero()
        || amount(wallet.currentDay.breachUsd).gt(0)
        || wallet.currentDay.riskLatched && wallet.currentDay.latchReason !== 'live_monitoring_gap'
        || wallet.blockedReason && !knownDelay(wallet.blockedReason, true)
        || wallet.intents.some(intent => intent.status === 'UNKNOWN'
          || intent.submittedOnce && !terminal.includes(intent.status)
          || amount(intent.executedQty).lt(0) || amount(intent.observedFillQty).lt(0)
          || !amount(intent.executedQty).eq(amount(intent.observedFillQty)))) return false;
    } catch { return false; }
  }
  return knownDelay(reason, wallet !== undefined);
}

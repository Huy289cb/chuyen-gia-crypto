import { describe, expect, it } from 'vitest';
import type { LivePortfolioWallet } from '../../src/portfolio/live-service';
import { isDeferrableLiveNotificationError as defer } from '../../src/portfolio/live-telegram-error-policy';

function context(): LivePortfolioWallet {
  return { equityQuality: 'reconciled', unreconciledWalletDelta: '0', blockedReason: null, intents: [],
    currentDay: { riskLatched: false, latchReason: null, breachUsd: '0' } } as unknown as LivePortfolioWallet;
}
const readFailure = (path: string) => `Binance portfolio GET ${path} failed (request_failed).`;
describe('live notification error boundaries', () => {
  it.each(['/fapi/v3/account', '/fapi/v3/positionRisk', '/fapi/v1/openOrders', '/fapi/v1/openAlgoOrders',
    '/fapi/v1/userTrades', '/fapi/v1/income', '/fapi/v1/exchangeInfo', '/fapi/v1/premiumIndex',
    '/fapi/v2/ticker/price', '/fapi/v1/commissionRate', '/fapi/v1/symbolConfig',
    '/fapi/v1/positionSide/dual', '/fapi/v1/leverageBracket'])('defers only a known pure-read transport failure: %s', path => {
    expect(defer(readFailure(path), context())).toBe(true);
  });
  it.each(['Authenticated background metadata unavailable', 'Authenticated background history unavailable',
    'Authenticated background orders unavailable; Authenticated background history unavailable',
    'Authenticated history unavailable; conservative risk only: Authenticated background history unavailable'])('coalesces known auxiliary availability only with reconciled context: %s', reason => {
    expect(defer(reason, context())).toBe(true); expect(defer(reason)).toBe(false);
  });
  it.each(['BTC', 'ETH', 'BNB', 'SOL', 'XRP'])('accepts missing/stale known-coin quotes, never invalid/future ones: %s', coin => {
    expect(defer(`Live public book quote unavailable for ${coin}USDT (missing).`, context())).toBe(true);
    expect(defer(`Live public mark quote unavailable for ${coin}USDT (stale).`, context())).toBe(true);
    expect(defer(`Live public book quote unavailable for ${coin}USDT (invalid).`, context())).toBe(false);
    expect(defer(`Live public mark quote unavailable for ${coin}USDT (future).`, context())).toBe(false);
  });
  it.each(['Binance portfolio POST /fapi/v1/order failed (network_timeout).',
    'Binance portfolio DELETE /fapi/v1/order failed (request_failed).',
    'Binance portfolio GET /fapi/v1/order failed (request_failed).',
    'Binance portfolio GET /fapi/v1/order failed (network_timeout).',
    'Binance portfolio GET /fapi/v3/account failed (request_failed, code -2015).',
    'Binance portfolio GET /fapi/v3/account failed (invalid_response).',
    'Authenticated background metadata unavailable (code -1003)', 'Authenticated background intents unavailable',
    'Authenticated background orders unavailable; Authenticated background intents unavailable',
    'Authenticated history unavailable; conservative risk only: ledger reconciliation failed',
    'Network timeout with unowned position mismatch', 'Missing authenticated ICT boundary',
    'Live public book quote unavailable for DOGEUSDT (missing).',
    'Live public book quote unavailable for DOGEUSDT (disconnected).'])('never defers an execution, integrity or unrecognized error: %s', reason => {
    expect(defer(reason, context())).toBe(false);
  });
  it.each(['UNKNOWN', 'NEW', 'PARTIALLY_FILLED'])('preserves immediate notification with unresolved submitted intent: %s', status => {
    const w = context(); w.intents = [{ symbol: 'ETHUSDT', status, submittedOnce: true, executedQty: '0', observedFillQty: '0' }] as LivePortfolioWallet['intents'];
    expect(defer(readFailure('/fapi/v3/account'), w)).toBe(false);
  });
  it('keeps a FILLED acknowledgement without its full ledger or with invalid quantities immediate', () => {
    const w = context(); w.intents = [{ symbol: 'ETHUSDT', status: 'FILLED', submittedOnce: true, executedQty: '2', observedFillQty: '1' }] as LivePortfolioWallet['intents'];
    expect(defer('Authenticated background metadata unavailable', w)).toBe(false);
    w.intents[0].executedQty = 'Infinity'; w.intents[0].observedFillQty = 'Infinity';
    expect(defer('Network timeout', w)).toBe(false);
  });
  it('preserves money, manual-block and financial-stop overrides regardless of the external message', () => {
    for (const delta of ['.01', '-.01', 'NaN']) {
      const w = context(); w.unreconciledWalletDelta = delta;
      expect(defer('Authenticated background metadata unavailable', w)).toBe(false);
    }
    for (const reason of ['unowned position mismatch', 'missing_authenticated_ict_boundary', 'Missing financial observation']) {
      const w = context(); w.blockedReason = reason;
      expect(defer('Network timeout', w)).toBe(false);
    }
    const w = context(); w.currentDay.riskLatched = true; w.currentDay.latchReason = 'fixed_daily_loss_observed';
    expect(defer('Network timeout', w)).toBe(false);
    w.currentDay.riskLatched = false; w.currentDay.breachUsd = '.1';
    expect(defer('Network timeout', w)).toBe(false);
  });
});

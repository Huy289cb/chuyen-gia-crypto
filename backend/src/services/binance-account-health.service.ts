/**
 * Binance Futures account tradability probe.
 *
 * On Binance Demo (demo-fapi.binance.com), balance/account/positionRisk often return -1109
 * even when order placement works. Use a trading probe instead of getBalance().
 */

import { testOrder } from './binance/trading';
import { config } from './binance/config';

export const BINANCE_INVALID_ACCOUNT_CODE = -1109;

const HEALTH_CACHE_TTL_MS = 60_000;

let cachedHealth: { tradable: boolean; reason: string; checkedAt: number } | null = null;

/** Record successful trading-endpoint access (openOrders, algoOrder, etc.) for demo soft gate. */
export function recordBinanceTradingAccessObserved(source: string): void {
  const reason = `Trading access observed (${source})`;
  cachedHealth = { tradable: true, reason, checkedAt: Date.now() };
}

export function isBinanceInvalidAccountError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const withCode = error as Error & { binanceCode?: number; code?: number };
  const code = withCode.binanceCode ?? withCode.code;
  if (code === BINANCE_INVALID_ACCOUNT_CODE) {
    return true;
  }
  return error.message.includes(`Error ${BINANCE_INVALID_ACCOUNT_CODE}`) || error.message.includes('-1109');
}

/**
 * -1109 on balance/account/positionRisk is a known Binance Demo quirk — not proof the wallet is inactive.
 * Trading endpoints (order, openOrders, userTrades) remain authoritative for tradability.
 * listenKey also returns -1109 on demo — rely on reconciliation polling instead of WS.
 */
export function isBinanceDemoMetadataUnavailableError(error: unknown): boolean {
  if (!isBinanceInvalidAccountError(error)) {
    return false;
  }
  const baseUrl = process.env.BINANCE_BASE_URL || config.BASE_URL;
  return baseUrl.includes('demo-fapi.binance.com');
}

/** User-facing message when trading probe fails with -1109. */
export function formatBinanceInvalidAccountMessage(): string {
  const baseUrl = process.env.BINANCE_BASE_URL || config.BASE_URL;
  return (
    `Binance API -1109 (Invalid account): order placement probe failed on ${baseUrl}. ` +
    'Confirm API keys are from the same environment as BINANCE_BASE_URL ' +
    '(demo: https://demo-fapi.binance.com via demo.binance.com API Management). ' +
    'Note: demo may return -1109 on balance/position endpoints while trading still works.'
  );
}

async function probeBinanceTradingAccess(): Promise<void> {
  await testOrder({
    symbol: config.SYMBOL,
    side: 'BUY',
    type: 'LIMIT',
    timeInForce: 'GTC',
    quantity: '0.001',
    price: '50000',
  });
}

/**
 * Verify the configured key can place orders (order/test probe).
 * Result is cached briefly to avoid hammering Binance during reconciliation loops.
 */
export async function checkBinanceAccountTradable(force = false): Promise<{
  tradable: boolean;
  reason: string;
}> {
  if (process.env.BINANCE_ENABLED !== 'true') {
    return { tradable: false, reason: 'BINANCE_ENABLED is not true' };
  }

  const now = Date.now();
  if (!force && cachedHealth && now - cachedHealth.checkedAt < HEALTH_CACHE_TTL_MS) {
    return { tradable: cachedHealth.tradable, reason: cachedHealth.reason };
  }

  try {
    await probeBinanceTradingAccess();
    const reason = 'Binance trading access verified (order/test)';
    cachedHealth = { tradable: true, reason, checkedAt: now };
    return { tradable: true, reason };
  } catch (error: unknown) {
    if (isBinanceInvalidAccountError(error)) {
      // Demo order/test often returns -1109 even when openOrders/algoOrders work.
      if (isBinanceDemoMetadataUnavailableError(error)) {
        if (cachedHealth?.tradable) {
          return {
            tradable: true,
            reason: `demo: order/test -1109 ignored; ${cachedHealth.reason}`,
          };
        }
        const reason =
          'demo: order/test returned -1109 (inconclusive); proceeding via openOrders/algoOrders';
        return { tradable: true, reason };
      }
      const reason = formatBinanceInvalidAccountMessage();
      cachedHealth = { tradable: false, reason, checkedAt: now };
      return { tradable: false, reason };
    }
    const message = error instanceof Error ? error.message : String(error);
    cachedHealth = { tradable: false, reason: message, checkedAt: now };
    return { tradable: false, reason: message };
  }
}

/** True when a recent probe returned non-tradable (used to throttle noisy reconciliation). */
export function isBinanceAccountKnownUnhealthy(): boolean {
  if (!cachedHealth || cachedHealth.tradable) {
    return false;
  }
  return Date.now() - cachedHealth.checkedAt < HEALTH_CACHE_TTL_MS;
}

export function clearBinanceAccountHealthCache(): void {
  cachedHealth = null;
}

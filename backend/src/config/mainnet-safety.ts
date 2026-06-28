/**
 * Mainnet safety gates.
 *
 * Mainnet can be used in read-only/shadow mode by pointing BINANCE_BASE_URL at
 * fapi.binance.com. Any trading mutation remains blocked until the explicit
 * live-trading acknowledgement is present.
 */

const MAINNET_HOST = 'fapi.binance.com';
const MAINNET_ACK_VALUE = 'I_UNDERSTAND_REAL_MONEY';
const DEFAULT_MAINNET_MAX_EXPOSURE_USD = 50;
const DEFAULT_MAINNET_MAX_LEVERAGE = 5;
const DEFAULT_MAINNET_MAX_RISK_PERCENT = 0.25;

export function getBinanceBaseUrl(): string {
  return process.env.BINANCE_BASE_URL?.trim() || 'https://demo-fapi.binance.com';
}

export function isBinanceMainnet(): boolean {
  try {
    return new URL(getBinanceBaseUrl()).hostname.toLowerCase() === MAINNET_HOST;
  } catch {
    return getBinanceBaseUrl().toLowerCase() === MAINNET_HOST;
  }
}

export function isMainnetLiveTradingEnabled(): boolean {
  return (
    isBinanceMainnet() &&
    process.env.MAINNET_LIVE_TRADING_ENABLED === 'true' &&
    process.env.MAINNET_TRADING_ACK === MAINNET_ACK_VALUE
  );
}

export function getMainnetMaxExposureUsd(): number {
  const raw = process.env.MAINNET_MAX_TOTAL_EXPOSURE_USD?.trim();
  const parsed = raw ? parseFloat(raw) : DEFAULT_MAINNET_MAX_EXPOSURE_USD;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAINNET_MAX_EXPOSURE_USD;
}

export function getMainnetMaxLeverage(): number {
  const raw = process.env.MAINNET_MAX_LEVERAGE?.trim();
  const parsed = raw ? parseInt(raw, 10) : DEFAULT_MAINNET_MAX_LEVERAGE;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAINNET_MAX_LEVERAGE;
}

export function getMainnetMaxRiskPercent(): number {
  const raw = process.env.MAINNET_MAX_RISK_PER_TRADE_PERCENT?.trim();
  const parsed = raw ? parseFloat(raw) : DEFAULT_MAINNET_MAX_RISK_PERCENT;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAINNET_MAX_RISK_PERCENT;
}

export function getEffectiveMaxExposureUsd(configured: number): number {
  if (!isBinanceMainnet()) return configured;
  return Math.min(configured, getMainnetMaxExposureUsd());
}

export function getEffectiveRiskPerTradePercent(configured: number): number {
  if (!isBinanceMainnet()) return configured;
  return Math.min(configured, getMainnetMaxRiskPercent());
}

export function isBinanceTradingMutation(method: string, path: string): boolean {
  const upperMethod = method.toUpperCase();
  if (upperMethod === 'GET') return false;

  return (
    path === '/fapi/v1/order' ||
    path === '/fapi/v1/batchOrders' ||
    path === '/fapi/v1/algoOrder' ||
    path === '/fapi/v1/allOpenOrders' ||
    path === '/fapi/v1/leverage' ||
    path === '/fapi/v1/marginType' ||
    path === '/fapi/v1/positionSide/dual'
  );
}

export function assertBinanceMutationAllowed(method: string, path: string): void {
  if (!isBinanceMainnet() || !isBinanceTradingMutation(method, path)) return;
  if (isMainnetLiveTradingEnabled()) return;

  throw new Error(
    `Mainnet trading mutation blocked for ${method.toUpperCase()} ${path}. ` +
      `Set MAINNET_LIVE_TRADING_ENABLED=true and MAINNET_TRADING_ACK=${MAINNET_ACK_VALUE} only after shadow validation.`
  );
}

export function validateMainnetSafetyRequirements(): string[] {
  if (process.env.BINANCE_ENABLED !== 'true' || !isBinanceMainnet()) {
    return [];
  }

  const errors: string[] = [];
  const live = process.env.MAINNET_LIVE_TRADING_ENABLED === 'true';
  const ack = process.env.MAINNET_TRADING_ACK;
  const leverage = parseInt(process.env.BINANCE_LEVERAGE || '20', 10);
  const maxLeverage = getMainnetMaxLeverage();
  const exposure = parseFloat(
    process.env.MAX_TOTAL_EXPOSURE_USD ||
      process.env.MAX_PENDING_VOLUME_USD ||
      String(DEFAULT_MAINNET_MAX_EXPOSURE_USD)
  );
  const mainnetExposure = getMainnetMaxExposureUsd();
  const riskPercent = parseFloat(process.env.RISK_PER_TRADE_PERCENT || '0.5');
  const maxRiskPercent = getMainnetMaxRiskPercent();

  if (live && ack !== MAINNET_ACK_VALUE) {
    errors.push(`MAINNET_LIVE_TRADING_ENABLED=true requires MAINNET_TRADING_ACK=${MAINNET_ACK_VALUE}`);
  }
  if (Number.isFinite(leverage) && leverage > maxLeverage) {
    errors.push(`BINANCE_LEVERAGE=${leverage} exceeds MAINNET_MAX_LEVERAGE=${maxLeverage}`);
  }
  if (Number.isFinite(exposure) && exposure > mainnetExposure) {
    errors.push(
      `MAX_TOTAL_EXPOSURE_USD=${exposure} exceeds MAINNET_MAX_TOTAL_EXPOSURE_USD=${mainnetExposure}`
    );
  }
  if (Number.isFinite(riskPercent) && riskPercent > maxRiskPercent) {
    errors.push(
      `RISK_PER_TRADE_PERCENT=${riskPercent} exceeds MAINNET_MAX_RISK_PER_TRADE_PERCENT=${maxRiskPercent}`
    );
  }

  return errors;
}


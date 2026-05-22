/**
 * Position monitor thresholds — conservative defaults to protect PnL.
 * Exchange SL/TP are preferred when placed on Binance.
 */

export function isPositionMonitorReduceEnabled(): boolean {
  return process.env.POSITION_MONITOR_ALLOW_REDUCE === 'true';
}

/** Default false — exchange SL/TP close positions (PnL+ P0). */
export function isPositionMonitorExitEnabled(): boolean {
  return process.env.POSITION_MONITOR_ALLOW_EXIT === 'true';
}

/** Skip monitor actions on young positions (let exchange orders work). */
export function getMinMinutesBeforeMonitorAction(): number {
  const v = parseInt(process.env.POSITION_MONITOR_MIN_MINUTES || '30', 10);
  return Number.isFinite(v) && v >= 0 ? v : 30;
}

/** Do not reduce/exit on noise — require |pnl%| above this (unless SL progress critical). */
export function getMinPnlPercentForMonitorAction(): number {
  const v = parseFloat(process.env.POSITION_MONITOR_MIN_PNL_PCT || '0.5');
  return Number.isFinite(v) && v >= 0 ? v : 0.5;
}

/** Cooldown after failed Binance close/reduce (ms). */
export function getPrecisionSkipMs(): number {
  const mins = parseInt(process.env.POSITION_MONITOR_PRECISION_SKIP_MIN || '30', 10);
  return (Number.isFinite(mins) && mins > 0 ? mins : 30) * 60 * 1000;
}

/** When true, monitor only marks prices — no reduce/exit if Binance SL+TP order ids exist. */
export function deferToExchangeSlTp(): boolean {
  return process.env.POSITION_MONITOR_DEFER_TO_EXCHANGE_SLTP !== 'false';
}

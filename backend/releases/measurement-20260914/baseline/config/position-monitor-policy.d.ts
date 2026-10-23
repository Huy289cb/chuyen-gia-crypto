/**
 * Position monitor thresholds — conservative defaults to protect PnL.
 * Exchange SL/TP are preferred when placed on Binance.
 */
export declare function isPositionMonitorReduceEnabled(): boolean;
/** Default false — exchange SL/TP close positions (PnL+ P0). */
export declare function isPositionMonitorExitEnabled(): boolean;
/**
 * P1.6: Allow emergency market exit when exchange SL missing and price at/near planned SL.
 * Default true — does not enable discretionary exit for hedged positions.
 */
export declare function isUnhedgedEmergencyExitEnabled(): boolean;
/** Skip monitor actions on young positions (let exchange orders work). */
export declare function getMinMinutesBeforeMonitorAction(): number;
/** Do not reduce/exit on noise — require |pnl%| above this (unless SL progress critical). */
export declare function getMinPnlPercentForMonitorAction(): number;
/** Cooldown after failed Binance close/reduce (ms). */
export declare function getPrecisionSkipMs(): number;
/** When true, monitor only marks prices — no reduce/exit if Binance SL+TP order ids exist. */
export declare function deferToExchangeSlTp(): boolean;
//# sourceMappingURL=position-monitor-policy.d.ts.map
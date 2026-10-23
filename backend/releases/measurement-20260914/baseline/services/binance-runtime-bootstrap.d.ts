/**
 * Start Binance user stream + reconciliation on the process that executes trades (worker).
 * Avoids duplicate listen keys when API and worker would both connect.
 */
export declare function bootstrapBinanceOnWorker(): Promise<void>;
export declare function shutdownBinanceRuntime(): Promise<void>;
//# sourceMappingURL=binance-runtime-bootstrap.d.ts.map
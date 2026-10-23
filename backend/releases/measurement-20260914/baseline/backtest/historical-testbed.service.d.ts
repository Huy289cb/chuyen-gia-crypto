import type { BacktestRunOptions, BacktestRunResult } from './types';
export declare function runHistoricalTestbed(options?: BacktestRunOptions): Promise<BacktestRunResult>;
/** Compare multiple min-SL settings on the same period (offline sweep). */
export declare function runHistoricalTestbedSlSweep(slPcts: number[], baseOptions?: BacktestRunOptions): Promise<BacktestRunResult[]>;
export declare function formatTestbedReport(result: BacktestRunResult): string;
//# sourceMappingURL=historical-testbed.service.d.ts.map
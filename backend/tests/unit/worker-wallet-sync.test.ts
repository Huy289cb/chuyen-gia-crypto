import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({schedule:vi.fn(),wallet:vi.fn(),simulatedFill:vi.fn()}));
vi.mock('node-cron',()=>({default:{schedule:mocks.schedule}}));
vi.mock('../../src/config/app',()=>({appConfig:{priceUpdateIntervalMs:30000,
  predictionValidationCron:'validate',snapshotCron:'snapshot',dailyMaintenanceCron:'maintenance'}}));
vi.mock('../../src/config/worker',()=>({validateWorkerConfig:vi.fn(),workerConfig:{
  syncSymbols:['BTC'],enableTestnetSync:false,ohlcvTimeframe:'5m'}}));
vi.mock('../../src/repositories/analysis.repository',()=>({validatePredictions:vi.fn()}));
vi.mock('../../src/repositories/market.repository',()=>({saveLatestPrice:vi.fn(),savePriceHistory:vi.fn()}));
vi.mock('../../src/services/runtime-maintenance',()=>({createTradingSnapshots:vi.fn(),runDataRetention:vi.fn()}));
vi.mock('../../src/services/testnet-sync',()=>({syncTestnetForSymbol:mocks.simulatedFill}));
vi.mock('../../src/services/price-fetcher',()=>({fetchRealTimePrices:vi.fn().mockResolvedValue({btc:{price:79168.8,volume:100}})}));
vi.mock('../../src/schedulers/market-scan.scheduler',()=>({startMarketScanScheduler:vi.fn()}));
vi.mock('../../src/schedulers/llm-dispatch.scheduler',()=>({startLLMDispatchScheduler:vi.fn()}));
vi.mock('../../src/schedulers/position-monitor.scheduler',()=>({startPositionMonitorScheduler:vi.fn()}));
vi.mock('../../src/schedulers/pending-order.scheduler',()=>({startPendingOrderScheduler:vi.fn()}));
vi.mock('../../src/services/binance-balance-sync.service',()=>({syncAllTestnetAccountsFromBinance:mocks.wallet}));
vi.mock('../../src/services/protective-exposure-audit.service',()=>({auditProtectiveCoverageForSymbols:vi.fn()}));
import {startWorkerScheduler,stopWorkerScheduler} from '../../src/services/worker-scheduler';
describe('real exchange wallet sync with simulated fills disabled',()=>{
  beforeEach(()=>{vi.clearAllMocks();vi.useFakeTimers();vi.stubEnv('PROTECTIVE_EXPOSURE_AUDIT_ENABLED','false');
    mocks.schedule.mockReturnValue({stop:vi.fn()});mocks.wallet.mockResolvedValue(undefined);});
  afterEach(()=>{stopWorkerScheduler();vi.useRealTimers();vi.unstubAllEnvs();});
  it('syncs at startup and every five minutes without starting simulated fills',async()=>{
    vi.stubEnv('BINANCE_ENABLED','true');await startWorkerScheduler();
    expect(mocks.wallet).toHaveBeenCalledOnce();expect(mocks.simulatedFill).not.toHaveBeenCalled();
    const task=mocks.schedule.mock.calls.find(([cron])=>cron==='*/5 * * * *');expect(task).toBeDefined();
    task![1]();expect(mocks.wallet).toHaveBeenCalledTimes(2);
  });
  it('does not access exchange balances when Binance is disabled',async()=>{
    vi.stubEnv('BINANCE_ENABLED','false');await startWorkerScheduler();
    expect(mocks.wallet).not.toHaveBeenCalled();expect(mocks.schedule.mock.calls.some(([cron])=>cron==='*/5 * * * *')).toBe(false);
  });
});

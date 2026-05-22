import cron, { type ScheduledTask } from 'node-cron';
import { appConfig } from '../config/app';
import { validateWorkerConfig, workerConfig } from '../config/worker';
import { validatePredictions } from '../repositories/analysis.repository';
import { saveLatestPrice, savePriceHistory } from '../repositories/market.repository';
import { createTradingSnapshots, runDataRetention } from './runtime-maintenance';
import { syncTestnetForSymbol } from './testnet-sync';
import { fetchRealTimePrices } from './price-fetcher';
// CRITICAL: Legacy kim_nghia auto-entry DISABLED per Big Update v3
// import { runKimNghiaAnalysisJob } from './kim-nghia-analysis-job';
import { startMarketScanScheduler } from '../schedulers/market-scan.scheduler';
import { startLLMDispatchScheduler } from '../schedulers/llm-dispatch.scheduler';
import { V3_LLM_DISPATCH_CRON, V3_MARKET_SCAN_CRON } from '../config/v3-schedulers';
import { startPositionMonitorScheduler } from '../schedulers/position-monitor.scheduler';
import { syncAllTestnetAccountsFromBinance } from './binance-balance-sync.service';

let priceSyncInterval: NodeJS.Timeout | null = null;
const cronTasks: ScheduledTask[] = [];
let priceSyncJobRunning = false;

const priceHistoryIntervalMs = parseInt(process.env.PRICE_HISTORY_INTERVAL_MS || '300000', 10);
const lastPriceHistoryAt = new Map<string, number>();
const lastTickerPrice = new Map<string, number>();

async function runPriceSyncJob() {
  if (priceSyncJobRunning) {
    console.warn('[WorkerScheduler] Previous price sync still running, skipping cycle');
    return;
  }

  priceSyncJobRunning = true;
  try {
    const prices = await fetchRealTimePrices();
    const symbolToCandle = {
      BTC: prices.btc,
      ETH: prices.eth,
    };

    const updates: Array<{ coin: string; price: number; volume: number }> = [];
    for (const symbol of workerConfig.syncSymbols) {
      const candle = symbolToCandle[symbol as keyof typeof symbolToCandle];
      if (!candle) {
        continue;
      }
      updates.push({ coin: symbol, price: candle.price, volume: candle.volume });
    }

    if (updates.length === 0) {
      console.warn(
        `[WorkerScheduler] No matching symbols to sync. configured=${workerConfig.syncSymbols.join(',')}`
      );
      return;
    }

    for (const item of updates) {
      const prevPrice = lastTickerPrice.get(item.coin);
      const priceMoved =
        prevPrice == null ||
        Math.abs(item.price - prevPrice) / Math.max(Math.abs(prevPrice), 1e-9) >= 0.0001;
      lastTickerPrice.set(item.coin, item.price);

      if (priceMoved) {
        await saveLatestPrice({
          coin: item.coin,
          price: item.price,
          volume24h: item.volume,
        });
      }

      const lastHist = lastPriceHistoryAt.get(item.coin) ?? 0;
      if (Date.now() - lastHist >= priceHistoryIntervalMs) {
        await savePriceHistory(item.coin, item.price);
        lastPriceHistoryAt.set(item.coin, Date.now());
      }

      const candle = symbolToCandle[item.coin as keyof typeof symbolToCandle];
      if (workerConfig.enableTestnetSync && candle) {
        await syncTestnetForSymbol(item.coin, candle);
      }
    }

    console.log(`[WorkerScheduler] Price sync completed for ${updates.map((u) => u.coin).join(', ')}`);
  } catch (error) {
    console.error('[WorkerScheduler] Price sync job failed:', error);
  } finally {
    priceSyncJobRunning = false;
  }
}

async function runPredictionValidationJob() {
  try {
    const validatedCount = await validatePredictions();
    console.log(
      `[WorkerScheduler] Prediction validation completed. Updated ${validatedCount} expired prediction(s).`
    );
  } catch (error) {
    console.error('[WorkerScheduler] Prediction validation job failed:', error);
  }
}

async function runSnapshotJob() {
  try {
    await createTradingSnapshots();
    console.log('[WorkerScheduler] Snapshot job completed');
  } catch (error) {
    console.error('[WorkerScheduler] Snapshot job failed:', error);
  }
}

async function runMaintenanceJob() {
  try {
    const result = await runDataRetention(
      appConfig.retentionDaysPriceHistory,
      appConfig.retentionDaysOhlcv
    );
    console.log(
      `[WorkerScheduler] Maintenance completed. deleted price_history=${result.priceHistoryDeleted}, ohlcv=${result.ohlcvDeleted}`
    );
  } catch (error) {
    console.error('[WorkerScheduler] Maintenance job failed:', error);
  }
}

export async function startWorkerScheduler(): Promise<void> {
  console.log('[WorkerScheduler] Starting scheduler...');
  validateWorkerConfig();

  // Prime initial data so API can immediately serve fresh prices.
  await runPriceSyncJob();

  priceSyncInterval = setInterval(() => {
    void runPriceSyncJob();
  }, appConfig.priceUpdateIntervalMs);

  const validationTask = cron.schedule(appConfig.predictionValidationCron, () => {
    void runPredictionValidationJob();
  });
  cronTasks.push(validationTask);

  const snapshotTask = cron.schedule(appConfig.snapshotCron, () => {
    void runSnapshotJob();
  });
  cronTasks.push(snapshotTask);

  const maintenanceTask = cron.schedule(appConfig.dailyMaintenanceCron, () => {
    void runMaintenanceJob();
  });
  cronTasks.push(maintenanceTask);

  // CRITICAL: Legacy kim_nghia analysis cron task DISABLED per Big Update v3
  // const analysisTask = cron.schedule(appConfig.analysisCronSchedule, () => {
  //   void runKimNghiaCronJob();
  // });
  // cronTasks.push(analysisTask);

  // Start new Big Update v3 schedulers
  console.log('[WorkerScheduler] Starting Big Update v3 schedulers...');
  
  // Market scan scheduler - runs every 5 minutes
  startMarketScanScheduler(V3_MARKET_SCAN_CRON);

  // LLM dispatch — offset +2 min after market scan boundaries
  startLLMDispatchScheduler(V3_LLM_DISPATCH_CRON);
  
  // Position monitor scheduler - runs every minute
  startPositionMonitorScheduler('*/1 * * * *');

  if (workerConfig.enableTestnetSync && process.env.BINANCE_ENABLED === 'true') {
    const balanceSyncTask = cron.schedule('*/5 * * * *', () => {
      void syncAllTestnetAccountsFromBinance();
    });
    cronTasks.push(balanceSyncTask);
    void syncAllTestnetAccountsFromBinance();
  }

  console.log(
    `[WorkerScheduler] Started. symbols=${workerConfig.syncSymbols.join(',')} timeframe=${workerConfig.ohlcvTimeframe} testnetSync=${workerConfig.enableTestnetSync} priceInterval=${appConfig.priceUpdateIntervalMs}ms validationCron="${appConfig.predictionValidationCron}" snapshotCron="${appConfig.snapshotCron}" maintenanceCron="${appConfig.dailyMaintenanceCron}" analysisCron="${appConfig.analysisCronSchedule}"`
  );
}

export function stopWorkerScheduler(): void {
  if (priceSyncInterval) {
    clearInterval(priceSyncInterval);
    priceSyncInterval = null;
  }

  for (const task of cronTasks) {
    task.stop();
  }
  cronTasks.length = 0;

  // Stop Big Update v3 schedulers
  // Note: These schedulers have their own stop functions
  // For now, they will be stopped when the process exits

  console.log('[WorkerScheduler] Stopped');
}

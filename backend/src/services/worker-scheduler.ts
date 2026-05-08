import cron, { type ScheduledTask } from 'node-cron';
import { appConfig } from '../config/app';
import { validateWorkerConfig, workerConfig } from '../config/worker';
import { validatePredictions } from '../repositories/analysis.repository';
import {
  saveLatestPrice,
  saveOhlcvCandle,
  savePriceHistory,
} from '../repositories/market.repository';
import { syncPaperTradingForSymbol } from './paper-trading-sync';
import { createTradingSnapshots, runDataRetention } from './runtime-maintenance';
import { syncTestnetForSymbol } from './testnet-sync';
import { fetchRealTimePrices } from './price-fetcher';

let priceSyncInterval: NodeJS.Timeout | null = null;
const cronTasks: ScheduledTask[] = [];
let priceSyncJobRunning = false;

async function runPriceSyncJob() {
  if (priceSyncJobRunning) {
    console.warn('[WorkerScheduler] Previous price sync still running, skipping cycle');
    return;
  }

  priceSyncJobRunning = true;
  try {
    const prices = await fetchRealTimePrices();
    const now = new Date();
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
      await saveLatestPrice({
        coin: item.coin,
        price: item.price,
        volume24h: item.volume,
      });
      await savePriceHistory(item.coin, item.price);
      await saveOhlcvCandle({
        coin: item.coin,
        timestamp: now,
        open: item.price,
        high: item.price,
        low: item.price,
        close: item.price,
        volume: item.volume,
        timeframe: workerConfig.ohlcvTimeframe,
      });

      const candle = symbolToCandle[item.coin as keyof typeof symbolToCandle];
      if (workerConfig.enablePaperTradingSync && candle) {
        await syncPaperTradingForSymbol(item.coin, candle);
      }
      if (workerConfig.enableTestnetSync && process.env.BINANCE_ENABLED === 'true' && candle) {
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

  console.log(
    `[WorkerScheduler] Started. symbols=${workerConfig.syncSymbols.join(',')} timeframe=${workerConfig.ohlcvTimeframe} paperTradingSync=${workerConfig.enablePaperTradingSync} testnetSync=${workerConfig.enableTestnetSync} priceInterval=${appConfig.priceUpdateIntervalMs}ms validationCron="${appConfig.predictionValidationCron}" snapshotCron="${appConfig.snapshotCron}" maintenanceCron="${appConfig.dailyMaintenanceCron}"`
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

  console.log('[WorkerScheduler] Stopped');
}

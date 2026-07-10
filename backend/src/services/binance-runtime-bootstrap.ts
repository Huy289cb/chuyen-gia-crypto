/**
 * Start Binance user stream + reconciliation on the process that executes trades (worker).
 * Avoids duplicate listen keys when API and worker would both connect.
 */

export async function bootstrapBinanceOnWorker(): Promise<void> {
  if (process.env.BINANCE_ENABLED !== 'true') {
    return;
  }

  const { initializeHedgeModeDetection } = await import('./binance-hedge-mode');
  await initializeHedgeModeDetection();

  const runUserStream = process.env.BINANCE_USER_STREAM_ON_WORKER !== 'false';
  if (runUserStream) {
    try {
      const { startBinanceWebSocketSync } = await import('./binance-websocket-sync');
      await startBinanceWebSocketSync();
      console.log('[BinanceRuntime] User data stream started on worker');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        '[BinanceRuntime] User data stream failed (non-fatal, reconciliation will still run):',
        message
      );
    }
  }

  const { initializeBinanceReconciliation } = await import('./binance-reconciliation');
  await initializeBinanceReconciliation();
  console.log('[BinanceRuntime] Reconciliation scheduled on worker');
}

export async function shutdownBinanceRuntime(): Promise<void> {
  if (process.env.BINANCE_ENABLED !== 'true') {
    return;
  }
  try {
    const { stopBinanceWebSocketSync } = await import('./binance-websocket-sync');
    stopBinanceWebSocketSync();
  } catch {
    /* optional */
  }
  try {
    const { stopPeriodicReconciliation } = await import('./binance-reconciliation');
    stopPeriodicReconciliation();
  } catch {
    /* optional */
  }
}

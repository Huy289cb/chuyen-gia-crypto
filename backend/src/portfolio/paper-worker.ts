import { advancePortfolioPaper, recordPaperWorkerStatus } from './paper-service';
import { PortfolioBusyError } from './paper-store';

// Dedicated worker in the existing backend. Public data and simulated ledger only.
let running = false;
async function tick(): Promise<void> {
  if (running) return;
  running = true;
  // A stalled public request must not leave an apparently healthy wallet locked forever.
  // Exiting also cancels outstanding promises before PM2 recovers the last atomic checkpoint.
  const watchdog = setTimeout(() => {
    const error = 'Public-data tick exceeded180seconds; recovering from the last committed paper wallet';
    console.error(`[PortfolioPaper] ${error}`);
    void recordPaperWorkerStatus({ status: 'degraded', pid: process.pid, error, mode: 'paper' })
      .finally(() => process.exit(1));
    setTimeout(() => process.exit(1), 2000);
  }, 180_000);
  try {
    const wallet = await advancePortfolioPaper();
    await recordPaperWorkerStatus({ status: 'running', pid: process.pid, lastSuccessfulTick: wallet.updatedAt,
      intervalMs: 60_000, mode: 'paper' });
  } catch (error) {
    if (!(error instanceof PortfolioBusyError)) {
      const message = (error as Error).message;
      console.error(`[PortfolioPaper] ${message}`);
      await recordPaperWorkerStatus({ status: 'degraded', pid: process.pid, error: message, mode: 'paper' });
    }
  } finally { clearTimeout(watchdog); running = false; }
}
void tick();
const timer = setInterval(() => { void tick(); }, 60_000);
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => { clearInterval(timer); void recordPaperWorkerStatus({ status: 'stopped', mode: 'paper' }).finally(() => process.exit(0)); });
}

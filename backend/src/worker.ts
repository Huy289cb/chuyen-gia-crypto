import { appConfig, isWorkerProcess } from './config/app';
import { validateAppConfig } from './config/app';
import { disconnectPrisma } from './lib/prisma';
import { startWorkerScheduler, stopWorkerScheduler } from './services/worker-scheduler';
import dotenv from 'dotenv';
dotenv.config({ path: require('path').resolve(__dirname, '../.env') });

/**
 * Worker Process Entry Point
 * 
 * This file starts the worker process which handles:
 * - Scheduler execution
 * - Price sync tasks
 * - Testnet sync tasks
 * - Background maintenance tasks
 * 
 * The worker acquires a leader lock before any scheduled execution.
 * It never exposes a public HTTP port.
 */

// Leader lock implementation using PostgreSQL advisory locks
async function acquireLeaderLock(): Promise<boolean> {
  try {
    const { prisma } = await import('./lib/prisma');
    
    // Use PostgreSQL advisory lock
    // This is a session-level lock that automatically releases on disconnect
    const result = await prisma.$queryRaw`
      SELECT pg_try_advisory_lock(${appConfig.workerLeaderLockKey}) as acquired
    ` as Array<{ acquired: boolean }>;
    
    const acquired = result[0]?.acquired || false;
    
    if (acquired) {
      console.log(`[Worker] Leader lock acquired (key: ${appConfig.workerLeaderLockKey})`);
    } else {
      console.log(`[Worker] Failed to acquire leader lock (key: ${appConfig.workerLeaderLockKey})`);
      console.log('[Worker] Another worker instance may be running');
    }
    
    return acquired;
  } catch (error) {
    console.error('[Worker] Error acquiring leader lock:', error);
    return false;
  }
}

async function releaseLeaderLock(): Promise<void> {
  try {
    const { prisma } = await import('./lib/prisma');
    
    await prisma.$queryRaw`
      SELECT pg_advisory_unlock(${appConfig.workerLeaderLockKey})
    `;
    
    console.log(`[Worker] Leader lock released (key: ${appConfig.workerLeaderLockKey})`);
  } catch (error) {
    console.error('[Worker] Error releasing leader lock:', error);
  }
}

async function startWorker() {
  console.log('[Worker] Starting worker process...');

  // Validate configuration
  try {
    validateAppConfig();
  } catch (error: any) {
    console.error('[Worker] Configuration validation failed:', error.message);
    process.exit(1);
  }

  // Ensure this is the worker process
  if (!isWorkerProcess()) {
    console.error('[Worker] Cannot start worker when API_ONLY is true');
    process.exit(1);
  }

  if (!appConfig.databaseUrl) {
    console.error('[Worker] DATABASE_URL is required to run worker jobs');
    process.exit(1);
  }

  // Acquire leader lock
  const lockAcquired = await acquireLeaderLock();
  if (!lockAcquired) {
    console.error('[Worker] Exiting - could not acquire leader lock');
    process.exit(1);
  }

  console.log('=================================');
  console.log('  Crypto Analyzer Worker');
  console.log('=================================');
  console.log(`Environment: ${appConfig.nodeEnv}`);
  console.log(`Process Type: Worker`);
  console.log(`Leader Lock Key: ${appConfig.workerLeaderLockKey}`);
  console.log(`Database: ${appConfig.databaseUrl ? 'configured' : 'NOT CONFIGURED'}`);
  console.log('=================================');

  // Start scheduler
  await startWorkerScheduler();

  // Keep the process alive
  console.log('[Worker] Worker is running. Press Ctrl+C to stop.');
}

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  console.log(`[Worker] ${signal} received. Shutting down gracefully...`);

  stopWorkerScheduler();

  // Release leader lock
  await releaseLeaderLock();
  
  // Disconnect Prisma
  await disconnectPrisma();
  console.log('[Worker] Prisma client disconnected');
  
  console.log('[Worker] Worker shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error: Error) => {
  console.error('[Worker] Uncaught exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason: unknown) => {
  console.error('[Worker] Unhandled rejection:', reason);
  gracefulShutdown('UNHANDLED_REJECTION');
});

// Start the worker
startWorker().catch((error) => {
  console.error('[Worker] Failed to start worker:', error);
  process.exit(1);
});

import { createApp } from './app';
import { appConfig, isApiProcess } from './config/app';
import { validateAppConfig } from './config/app';

/**
 * API Server Entry Point
 * 
 * This file starts the HTTP server for the API process.
 * It never starts scheduler jobs - those run only in the worker process.
 */

async function startServer() {
  console.log('[Server] Starting API server...');

  // Validate configuration
  try {
    validateAppConfig();
  } catch (error: any) {
    console.error('[Server] Configuration validation failed:', error.message);
    process.exit(1);
  }

  // Ensure this is the API process
  if (!isApiProcess()) {
    console.error('[Server] Cannot start API server when WORKER_ONLY is true');
    process.exit(1);
  }

  // Create Express app
  const app = createApp();

  // Start HTTP server
  const server = app.listen(appConfig.port, '0.0.0.0', () => {
    console.log('=================================');
    console.log('  Crypto Analyzer API Server');
    console.log('=================================');
    console.log(`Environment: ${appConfig.nodeEnv}`);
    console.log(`Port: ${appConfig.port}`);
    console.log(`Process Type: API`);
    console.log(`Database: ${appConfig.databaseUrl ? 'configured' : 'NOT CONFIGURED'}`);
    console.log('');
    console.log('Health check: http://localhost:' + appConfig.port + '/health');
    console.log('=================================');
  });

  // Handle server errors
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.syscall !== 'listen') {
      throw error;
    }

    const bind = typeof appConfig.port === 'string'
      ? 'Pipe ' + appConfig.port
      : 'Port ' + appConfig.port;

    switch (error.code) {
      case 'EACCES':
        console.error(`[Server] ${bind} requires elevated privileges`);
        process.exit(1);
        break;
      case 'EADDRINUSE':
        console.error(`[Server] ${bind} is already in use`);
        process.exit(1);
        break;
      default:
        throw error;
    }
  });

  // Graceful shutdown
  const gracefulShutdown = async (signal: string) => {
    console.log(`[Server] ${signal} received. Shutting down gracefully...`);
    
    server.close(async () => {
      console.log('[Server] HTTP server closed');
      const { disconnectPrisma } = await import('./lib/prisma');
      await disconnectPrisma();
      console.log('[Server] Prisma client disconnected');
      process.exit(0);
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
      console.error('[Server] Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

// Start the server
startServer().catch((error) => {
  console.error('[Server] Failed to start server:', error);
  process.exit(1);
});

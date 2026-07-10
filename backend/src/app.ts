import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { corsMiddleware } from './config/cors';
import apiRoutes from './routes/index';

/**
 * Create Express app with middleware and routes
 */
export function createApp(): Express {
  const app = express();

  // Trust proxy for rate limiting behind reverse proxy
  app.set('trust proxy', 1);

  // Middleware
  app.use(corsMiddleware);
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  // API routes
  app.use('/api', apiRoutes);

  // Root endpoint
  app.get('/', (_req: Request, res: Response) => {
    res.json({
      name: 'Crypto Analyzer API (TypeScript)',
      version: '2.0.0',
      status: 'running',
      endpoints: {
        '/api/health': 'Health check',
        '/api/prices': 'Get latest prices',
        '/api/analysis': 'Get recent analysis',
        '/api/latest-price/:coin': 'Get latest price for specific coin'
      }
    });
  });

  // 404 handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: 'Not found',
      path: req.path
    });
  });

  // Global error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[App] Error:', err.message);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  });

  return app;
}

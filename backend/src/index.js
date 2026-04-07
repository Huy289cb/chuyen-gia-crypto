import express from 'express';
import dotenv from 'dotenv';
import { startScheduler } from './scheduler.js';
import analysisRouter, { initDb } from './routes.js';
import { corsMiddleware } from './config/cors.js';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env from backend directory (parent of src directory)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for rate limiting behind reverse proxy
app.set('trust proxy', 1);

// Middleware
app.use(corsMiddleware);
app.use(express.json());

// Initialize database before setting up routes
let db = null;
let dbEnabled = false;

try {
  const result = await initDb();
  db = result.db;
  dbEnabled = result.dbEnabled;
  
  // Initialize paper trading accounts for BTC and ETH
  if (dbEnabled && db) {
    try {
      const { getOrCreateAccount } = await import('./db/database.js');
      await getOrCreateAccount(db, 'BTC', 100);
      await getOrCreateAccount(db, 'ETH', 100);
      console.log('[Index] Paper trading accounts initialized (BTC: 100U, ETH: 100U)');
    } catch (accountError) {
      console.log('[Index] Account initialization failed:', accountError.message);
    }
  }
} catch (error) {
  console.log('[Index] Database init failed:', error.message);
  dbEnabled = false;
}

// Routes
app.use('/api', analysisRouter);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Crypto Trend Analyzer API',
    version: '1.0.0',
    endpoints: {
      '/api/analysis': 'Get current trend analysis',
      '/api/health': 'Health check'
    }
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log('=================================');
  console.log('  Crypto Trend Analyzer Backend');
  console.log('=================================');
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Database: ${dbEnabled ? 'connected' : 'disconnected'}`);
  console.log('');
  
  // Start the scheduler
  startScheduler();
});

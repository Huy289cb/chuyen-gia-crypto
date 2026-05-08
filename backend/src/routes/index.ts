import { Router, Request, Response } from 'express';
import { getRecentAnalysis } from '../repositories/analysis.repository';
import { getLatestPrice } from '../repositories/market.repository';
import { fetchRealTimePrices } from '../services/price-fetcher';

const router = Router();

/**
 * GET /api/health - Health check endpoint
 */
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * GET /api/prices - Get latest prices
 */
router.get('/prices', async (_req: Request, res: Response) => {
  try {
    const prices = await fetchRealTimePrices();
    res.json(prices);
  } catch (error: any) {
    console.error('[Routes] Error fetching prices:', error.message);
    res.status(500).json({ error: 'Failed to fetch prices' });
  }
});

/**
 * GET /api/analysis - Get recent analysis
 */
router.get('/analysis', async (req: Request, res: Response) => {
  try {
    const coin = (req.query.coin as string) || 'BTC';
    const limit = parseInt(req.query.limit as string) || 10;
    const methodId = req.query.methodId as string;

    const result = await getRecentAnalysis(coin, limit, methodId);
    res.json(result);
  } catch (error: any) {
    console.error('[Routes] Error fetching analysis:', error.message);
    res.status(500).json({ error: 'Failed to fetch analysis' });
  }
});

/**
 * GET /api/latest-price/:coin - Get latest price for a specific coin
 */
router.get('/latest-price/:coin', async (req: Request, res: Response) => {
  try {
    const coin = (req.params.coin as string).toUpperCase();
    const price = await getLatestPrice(coin);

    if (!price) {
      res.status(404).json({ error: 'Price not found' });
      return;
    }

    res.json(price);
  } catch (error: any) {
    console.error('[Routes] Error fetching latest price:', error.message);
    res.status(500).json({ error: 'Failed to fetch latest price' });
  }
});

export default router;
